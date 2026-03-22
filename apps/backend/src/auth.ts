import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { AppEnv } from './config.js';

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  tier: 'starter' | 'pro' | 'enterprise';
  roles: Array<'admin' | 'operator' | 'analyst' | 'viewer' | 'service'>;
  licenseKey: string;
};

export type TokenPayload = JwtPayload & {
  sub: string;
  email: string;
  username: string;
  tier: AuthUser['tier'];
  roles?: AuthUser['roles'];
  licenseKey: string;
  sid?: string;
  jti?: string;
  amr?: string[];
  twoFactorVerified?: boolean;
  type: 'access' | 'refresh';
};

export type VerifiedToken = {
  user: AuthUser;
  claims: TokenPayload;
};

type SignupInput = {
  email: string;
  username: string;
  password: string;
  licenseKey: string;
};

type SignupResult =
  | {
      ok: true;
      user: AuthUser;
    }
  | {
      ok: false;
      error: 'invalid_license_key' | 'identity_exists' | 'auth_store_unavailable';
    };

const ALLOWED_ROLES: AuthUser['roles'] = ['admin', 'operator', 'analyst', 'viewer', 'service'];

function randomId(size = 18): string {
  return randomBytes(size).toString('base64url');
}

// In-memory fallback store — used when PostgreSQL is not available.
// Accounts persist for the lifetime of the backend process.
type MemUser = { user: AuthUser; passwordHash: string };
const memUsers = new Map<string, MemUser>(); // keyed by userId
function memLookup(identifier: string): MemUser | null {
  const norm = identifier.trim().toLowerCase();
  for (const entry of memUsers.values()) {
    if (entry.user.email.toLowerCase() === norm || entry.user.username.toLowerCase() === norm) {
      return entry;
    }
  }
  return null;
}

export function createAuthService(env: AppEnv, pool?: Pool | null) {
  const bootstrapUserId = 'user-bootstrap-1';
  const bootstrapHash = bcrypt.hashSync(env.AUTH_BOOTSTRAP_PASSWORD, 10);
  const bootstrapUsername = env.AUTH_BOOTSTRAP_USERNAME.trim().toLowerCase();

  function validateLicenseKey(licenseKey: string): boolean {
    const normalized = licenseKey.trim();
    if (!normalized) {
      return false;
    }
    if (normalized === env.AUTH_BOOTSTRAP_LICENSE_KEY.trim()) {
      return true;
    }
    return env.NODE_ENV !== 'production' && normalized === '007';
  }

  function normalizeRoles(roles: string[] | null | undefined): AuthUser['roles'] {
    const deduped = new Set<AuthUser['roles'][number]>();
    for (const role of roles ?? []) {
      const normalized = role.trim() as AuthUser['roles'][number];
      if (ALLOWED_ROLES.includes(normalized)) {
        deduped.add(normalized);
      }
    }
    if (deduped.size === 0) {
      deduped.add('viewer');
    }
    return Array.from(deduped);
  }

  async function lookupDatabaseUser(identifier: string): Promise<{
    user: AuthUser;
    passwordHash: string;
    active: boolean;
  } | null> {
    if (!pool) {
      // No database — fall back to the in-memory store.
      const found = memLookup(identifier);
      if (!found) return null;
      return { user: found.user, passwordHash: found.passwordHash, active: true };
    }

    const normalizedIdentifier = identifier.trim().toLowerCase();
    if (!normalizedIdentifier) {
      return null;
    }

    const result = await pool.query<{
      id: string;
      email: string;
      username: string;
      tier: AuthUser['tier'];
      license_key: string;
      is_active: boolean;
      password_hash: string;
      roles: string[] | null;
    }>(
      `SELECT u.id,
              u.email,
              u.username,
              u.tier,
              u.license_key,
              u.is_active,
              c.password_hash,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT ur.role), NULL) AS roles
         FROM auth_users u
         JOIN auth_credentials c
           ON c.user_id = u.id
         LEFT JOIN auth_user_roles ur
           ON ur.user_id = u.id
        WHERE LOWER(u.email) = $1
           OR LOWER(u.username) = $1
        GROUP BY u.id, u.email, u.username, u.tier, u.license_key, u.is_active, c.password_hash
        LIMIT 1`,
      [normalizedIdentifier],
    );

    if (!result.rows[0]) {
      return null;
    }

    const row = result.rows[0];
    return {
      user: {
        id: row.id,
        email: row.email,
        username: row.username,
        tier: row.tier,
        roles: normalizeRoles(row.roles),
        licenseKey: row.license_key,
      },
      passwordHash: row.password_hash,
      active: row.is_active,
    };
  }

  function validateBootstrapUser(
    identifier: string,
    password: string,
    licenseKey: string,
  ): AuthUser | null {
    const normalized = identifier.trim().toLowerCase();
    const emailMatch = normalized === env.AUTH_BOOTSTRAP_EMAIL.toLowerCase();
    const usernameMatch = normalized === bootstrapUsername;
    if (!emailMatch && !usernameMatch) {
      return null;
    }
    if (!validateLicenseKey(licenseKey)) {
      return null;
    }
    const passwordOk = bcrypt.compareSync(password, bootstrapHash);
    if (!passwordOk) {
      return null;
    }

    return {
      id: bootstrapUserId,
      email: env.AUTH_BOOTSTRAP_EMAIL,
      username: env.AUTH_BOOTSTRAP_USERNAME,
      tier: 'starter',
      roles: ['admin'],
      licenseKey: env.AUTH_BOOTSTRAP_LICENSE_KEY,
    };
  }

  async function validateUserCredentials(
    identifier: string,
    password: string,
    licenseKey: string,
  ): Promise<AuthUser | null> {
    const databaseUser = await lookupDatabaseUser(identifier);
    if (databaseUser) {
      if (!databaseUser.active) {
        return null;
      }
      if (databaseUser.user.licenseKey.trim() !== licenseKey.trim()) {
        return null;
      }
      const passwordOk = bcrypt.compareSync(password, databaseUser.passwordHash);
      if (!passwordOk) {
        return null;
      }
      return databaseUser.user;
    }

    return validateBootstrapUser(identifier, password, licenseKey);
  }

  async function createUserAccount(input: SignupInput): Promise<SignupResult> {
    if (!validateLicenseKey(input.licenseKey)) {
      return { ok: false, error: 'invalid_license_key' };
    }

    if (!pool) {
      // No database — persist to in-memory store for this process lifetime.
      const normalizedEmail = input.email.trim().toLowerCase();
      const normalizedUsername = input.username.trim().toLowerCase();
      if (memLookup(normalizedEmail) || memLookup(normalizedUsername)) {
        return { ok: false, error: 'identity_exists' };
      }
      const userId = `user-mem-${randomId(12)}`;
      const passwordHash = bcrypt.hashSync(input.password, 10);
      const user: AuthUser = {
        id: userId,
        email: normalizedEmail,
        username: normalizedUsername,
        tier: 'starter',
        roles: ['viewer'],
        licenseKey: input.licenseKey.trim(),
      };
      memUsers.set(userId, { user, passwordHash });
      return { ok: true, user };
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedUsername = input.username.trim().toLowerCase();
    const userId = `user-${randomId(12)}`;
    const passwordHash = bcrypt.hashSync(input.password, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        `SELECT 1
           FROM auth_users
          WHERE LOWER(email) = $1
             OR LOWER(username) = $2
          LIMIT 1`,
        [normalizedEmail, normalizedUsername],
      );
      if ((existing.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'identity_exists' };
      }

      await client.query(
        `INSERT INTO auth_users (id, tenant_id, email, username, tier, is_active, license_key)
         VALUES ($1, $2, $3, $4, 'starter', TRUE, $5)`,
        [
          userId,
          env.DEFAULT_TENANT_ID,
          normalizedEmail,
          normalizedUsername,
          input.licenseKey.trim(),
        ],
      );

      await client.query(
        `INSERT INTO auth_credentials (user_id, password_hash, password_algo)
         VALUES ($1, $2, 'bcrypt')`,
        [userId, passwordHash],
      );

      await client.query(
        `INSERT INTO auth_user_roles (user_id, role)
         VALUES ($1, 'viewer')`,
        [userId],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      const pgError = error as { code?: string };
      if (pgError?.code === '23505') {
        return { ok: false, error: 'identity_exists' };
      }
      throw error;
    } finally {
      client.release();
    }

    return {
      ok: true,
      user: {
        id: userId,
        email: normalizedEmail,
        username: normalizedUsername,
        tier: 'starter',
        roles: ['viewer'],
        licenseKey: input.licenseKey.trim(),
      },
    };
  }

  function sign(
    user: AuthUser,
    type: 'access' | 'refresh',
    claims: { sid: string; jti: string; amr?: string[]; twoFactorVerified?: boolean },
  ) {
    const expiresIn =
      type === 'access' ? env.AUTH_ACCESS_TOKEN_TTL_SECONDS : env.AUTH_REFRESH_TOKEN_TTL_SECONDS;
    const basePayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      tier: user.tier,
      roles: user.roles,
      licenseKey: user.licenseKey,
      sid: claims.sid,
      jti: claims.jti,
      amr: claims.amr ?? ['pwd'],
      twoFactorVerified: Boolean(claims.twoFactorVerified),
      type,
    };
    return jwt.sign(basePayload, env.JWT_SECRET, { expiresIn });
  }

  function issueTokenPair(
    user: AuthUser,
    options?: {
      sessionId?: string;
      amr?: string[];
      twoFactorVerified?: boolean;
    },
  ) {
    const sid = options?.sessionId ?? randomId(24);
    const accessJti = randomId(24);
    const refreshJti = randomId(24);
    return {
      token: sign(user, 'access', {
        sid,
        jti: accessJti,
        ...(options?.amr ? { amr: options.amr } : {}),
        ...(typeof options?.twoFactorVerified === 'boolean'
          ? { twoFactorVerified: options.twoFactorVerified }
          : {}),
      }),
      refreshToken: sign(user, 'refresh', {
        sid,
        jti: refreshJti,
        ...(options?.amr ? { amr: options.amr } : {}),
        ...(typeof options?.twoFactorVerified === 'boolean'
          ? { twoFactorVerified: options.twoFactorVerified }
          : {}),
      }),
      expiresInSeconds: env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      user,
      sessionId: sid,
      accessJti,
      refreshJti,
    };
  }

  function verifyTokenDetailed(token: string, type: 'access' | 'refresh'): VerifiedToken | null {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
      if (payload.type !== type) {
        return null;
      }
      if (
        !payload.sub ||
        !payload.email ||
        !payload.username ||
        !payload.tier ||
        !payload.licenseKey
      ) {
        return null;
      }
      return {
        claims: payload,
        user: {
          id: payload.sub,
          email: payload.email,
          username: payload.username,
          tier: payload.tier,
          roles: payload.roles ?? ['viewer'],
          licenseKey: payload.licenseKey,
        },
      };
    } catch {
      return null;
    }
  }

  function verifyToken(token: string, type: 'access' | 'refresh'): AuthUser | null {
    return verifyTokenDetailed(token, type)?.user ?? null;
  }

  return {
    validateBootstrapUser,
    validateUserCredentials,
    createUserAccount,
    issueTokenPair,
    verifyAccessTokenDetailed: (token: string) => verifyTokenDetailed(token, 'access'),
    verifyRefreshTokenDetailed: (token: string) => verifyTokenDetailed(token, 'refresh'),
    verifyAccessToken: (token: string) => verifyToken(token, 'access'),
    verifyRefreshToken: (token: string) => verifyToken(token, 'refresh'),
  };
}
