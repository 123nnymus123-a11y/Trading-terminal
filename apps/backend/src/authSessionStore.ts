import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export type SessionStatus = 'active' | 'revoked' | 'expired' | 'pending_2fa';

export type AuthSession = {
  id: string;
  userId: string;
  status: SessionStatus;
  clientType: 'desktop' | 'web' | 'service';
  deviceLabel: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

export type CreateSessionInput = {
  id: string;
  userId: string;
  expiresAtIso: string;
  clientType: AuthSession['clientType'];
  deviceLabel?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  status?: SessionStatus;
};

export type StoreRefreshTokenInput = {
  jti: string;
  sessionId: string;
  userId: string;
  token: string;
  expiresAtIso: string;
  rotatedFromJti?: string | null;
};

export type StoredRefreshToken = {
  jti: string;
  sessionId: string;
  userId: string;
  tokenHash: string;
  issuedAt: string;
  expiresAt: string;
  rotatedFromJti: string | null;
  consumedAt: string | null;
  revokedAt: string | null;
};

export class AuthSessionStore {
  constructor(private readonly pool: Pool) {}

  async createSession(input: CreateSessionInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_sessions (
         id, user_id, status, client_type, device_label, user_agent, ip_address, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.id,
        input.userId,
        input.status ?? 'active',
        input.clientType,
        input.deviceLabel ?? null,
        input.userAgent ?? null,
        input.ipAddress ?? null,
        input.expiresAtIso,
      ],
    );
  }

  async getSession(sessionId: string): Promise<AuthSession | null> {
    const result = await this.pool.query<AuthSession>(
      `SELECT
         id,
         user_id AS "userId",
         status,
         client_type AS "clientType",
         device_label AS "deviceLabel",
         user_agent AS "userAgent",
         ip_address AS "ipAddress",
         expires_at::text AS "expiresAt",
         created_at::text AS "createdAt",
         last_seen_at::text AS "lastSeenAt",
         revoked_at::text AS "revokedAt"
       FROM auth_sessions
       WHERE id = $1
       LIMIT 1`,
      [sessionId],
    );
    return result.rows[0] ?? null;
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.pool.query('UPDATE auth_sessions SET last_seen_at = NOW() WHERE id = $1', [
      sessionId,
    ]);
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions
       SET status = 'revoked',
           revoked_at = NOW(),
           revoke_reason = $2
       WHERE id = $1`,
      [sessionId, reason],
    );
  }

  async revokeAllUserSessions(userId: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions
       SET status = 'revoked',
           revoked_at = NOW(),
           revoke_reason = $2
       WHERE user_id = $1
         AND status <> 'revoked'`,
      [userId, reason],
    );
  }

  async setSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions
       SET status = $2,
           last_seen_at = NOW()
       WHERE id = $1`,
      [sessionId, status],
    );
  }

  async storeRefreshToken(input: StoreRefreshTokenInput): Promise<void> {
    const tokenHash = hashRefreshToken(input.token);
    await this.pool.query(
      `INSERT INTO auth_refresh_tokens (
         jti, session_id, user_id, token_hash, expires_at, rotated_from_jti
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.jti,
        input.sessionId,
        input.userId,
        tokenHash,
        input.expiresAtIso,
        input.rotatedFromJti ?? null,
      ],
    );
  }

  async consumeRefreshToken(jti: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_refresh_tokens
       SET consumed_at = NOW()
       WHERE jti = $1`,
      [jti],
    );
  }

  async getRefreshToken(jti: string): Promise<StoredRefreshToken | null> {
    const result = await this.pool.query<StoredRefreshToken>(
      `SELECT
         jti,
         session_id AS "sessionId",
         user_id AS "userId",
         token_hash AS "tokenHash",
         issued_at::text AS "issuedAt",
         expires_at::text AS "expiresAt",
         rotated_from_jti AS "rotatedFromJti",
         consumed_at::text AS "consumedAt",
         revoked_at::text AS "revokedAt"
       FROM auth_refresh_tokens
       WHERE jti = $1
       LIMIT 1`,
      [jti],
    );
    return result.rows[0] ?? null;
  }

  async revokeRefreshToken(jti: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_refresh_tokens
       SET revoked_at = NOW(),
           revoke_reason = $2
       WHERE jti = $1`,
      [jti, reason],
    );
  }

  async writeAuditEvent(input: {
    userId?: string;
    sessionId?: string;
    eventType: string;
    outcome: string;
    reason?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_audit_events (
         user_id, session_id, event_type, outcome, reason, metadata, ip_address, user_agent
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        input.userId ?? null,
        input.sessionId ?? null,
        input.eventType,
        input.outcome,
        input.reason ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.ipAddress ?? null,
        input.userAgent ?? null,
      ],
    );
  }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isRefreshTokenMatch(token: string, expectedHash: string): boolean {
  return hashRefreshToken(token) === expectedHash;
}
