export type AuthSession = {
  token: string;
  refreshToken: string;
  expiresAtMs: number;
  user: {
    id: string;
    email: string;
    username?: string;
    tier: 'starter' | 'pro' | 'enterprise';
    licenseKey: string;
  };
};

export type LoginPayload = {
  email?: string;
  username?: string;
  password: string;
  licenseKey: string;
};

export type SignupPayload = {
  email: string;
  username: string;
  password: string;
  licenseKey: string;
};

const TENANT_ID_STORAGE_KEY = 'tc.tenant.id.v1';
const PRODUCTION_BACKEND_URL = 'http://79.76.40.72:8787';
let inMemorySession: AuthSession | null = null;
let backendBaseUrl = PRODUCTION_BACKEND_URL;

function normalizeBackendUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export async function refreshBackendBaseUrl(): Promise<string> {
  try {
    const fromIpc = await window.cockpit?.journal?.backendUrlGet?.();
    if (typeof fromIpc === 'string' && fromIpc.trim()) {
      backendBaseUrl = normalizeBackendUrl(fromIpc);
      return backendBaseUrl;
    }
  } catch {
    // Browser mode and early boot can safely fallback.
  }

  const envUrl = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_TC_BACKEND_URL;
  backendBaseUrl = normalizeBackendUrl(envUrl && envUrl.trim() ? envUrl : PRODUCTION_BACKEND_URL);
  return backendBaseUrl;
}

void refreshBackendBaseUrl();

export function getBackendBaseUrl() {
  return backendBaseUrl;
}

export function setBackendBaseUrl(url: string) {
  const normalized = normalizeBackendUrl(url);
  if (!normalized) {
    return;
  }
  backendBaseUrl = normalized;
  void window.cockpit?.journal?.backendUrlSet?.(normalized);
}

export function getTenantId(): string | null {
  const value = localStorage.getItem(TENANT_ID_STORAGE_KEY);
  return value && value.trim() ? value.trim() : null;
}

export function setTenantId(value: string | null) {
  if (!value || !value.trim()) {
    localStorage.removeItem(TENANT_ID_STORAGE_KEY);
    return;
  }
  localStorage.setItem(TENANT_ID_STORAGE_KEY, value.trim());
}

function toUrl(path: string) {
  return `${getBackendBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(toUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(getTenantId() ? { 'x-tenant-id': getTenantId()! } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401) {
      // Auth endpoints (login/signup/refresh) use 401 for bad credentials — never
      // treat those as session expiry.
      const isAuthEndpoint = /\/api\/auth\/(login|signup|refresh)/.test(path);
      const isSessionInactive = /session_inactive/i.test(text);
      if (!isAuthEndpoint) {
        // Session-store enforcement rejects stale/restored tokens with
        // {"error":"session_inactive"}. In that case, force a re-auth flow.
        if (isSessionInactive) {
          await writeStoredSession(null).catch(() => {});
          window.dispatchEvent(new CustomEvent('tc:session-expired'));
          throw new Error(`api_error:401:${text || 'authentication_required'}`);
        }

        // Only fire session-expired when there is NO live token in memory.
        // A freshly-issued token can still get a 401 from permission/config
        // mismatches — that should not log the user out. Only kick them out
        // when the in-memory session is genuinely absent or expired.
        const sessionIsLive =
          inMemorySession !== null &&
          inMemorySession.expiresAtMs > Date.now() + 5_000;
        if (!sessionIsLive) {
          await writeStoredSession(null).catch(() => {});
          window.dispatchEvent(new CustomEvent('tc:session-expired'));
        }
      }
      throw new Error(`api_error:401:${text || 'authentication_required'}`);
    }
    throw new Error(`api_error:${response.status}:${text || response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function getRuntimeFlags(): Promise<{
  flags: {
    backendOnlyProcessing: boolean;
    desktopLocalFallback: boolean;
    webPrimaryRouting: boolean;
    requireTenantHeader: boolean;
  };
  tenant: { tenantId: string; source: 'header' | 'default' | 'user' };
}> {
  return requestJson('/api/runtime/flags', { method: 'GET' });
}

function decodeJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

const SESSION_LS_KEY = 'tc.session.v1';

export async function readStoredSession(): Promise<AuthSession | null> {
  if (inMemorySession) {
    return inMemorySession;
  }

  // Try IPC bridge first (Electron / cockpit)
  try {
    const session = await window.cockpit?.auth?.getSession?.();
    if (session && session.token && session.refreshToken && session.expiresAtMs) {
      inMemorySession = session as AuthSession;
      return inMemorySession;
    }
  } catch { /* bridge unavailable */ }

  // Fallback: localStorage persistence for browser mode
  try {
    const raw = localStorage.getItem(SESSION_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AuthSession;
      // Discard if expired or within 60 s of expiry (avoids refresh-on-load failures)
    if (
        parsed?.token &&
        parsed?.refreshToken &&
        typeof parsed?.expiresAtMs === 'number' &&
        parsed.expiresAtMs - 60_000 > Date.now()
      ) {
        inMemorySession = parsed;
        return inMemorySession;
      }
      // Expired or stale — clean up
      localStorage.removeItem(SESSION_LS_KEY);
    }
  } catch { /* corrupt JSON */ }

  return null;
}

export async function writeStoredSession(session: AuthSession | null) {
  inMemorySession = session;
  // Persist to localStorage for browser-mode refresh survival
  try {
    if (session) {
      localStorage.setItem(SESSION_LS_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_LS_KEY);
    }
  } catch { /* quota or SSR */ }
  // Also notify IPC bridge if available
  try {
    await window.cockpit?.auth?.setSession?.(session);
  } catch {
    return;
  }
}

export async function logout(): Promise<void> {
  try {
    await window.cockpit?.auth?.logout?.();
  } finally {
    await writeStoredSession(null);
  }
}

function normalizeSession(data: {
  token: string;
  refreshToken: string;
  expiresInSeconds?: number;
  expiresAtMs?: number;
  user: AuthSession['user'];
}): AuthSession {
  const expFromJwt = decodeJwtExp(data.token);
  const fallbackExp =
    typeof data.expiresAtMs === 'number'
      ? data.expiresAtMs
      : Date.now() + (data.expiresInSeconds ?? 3600) * 1000;
  return {
    token: data.token,
    refreshToken: data.refreshToken,
    expiresAtMs: expFromJwt ?? fallbackExp,
    user: data.user,
  };
}

export async function login(payload: LoginPayload): Promise<AuthSession> {
  if (window.cockpit?.auth?.login) {
    const ipcResponse = (await window.cockpit.auth.login(payload)) as
      | {
          ok: boolean;
          session?: {
            token: string;
            refreshToken: string;
            expiresAtMs?: number;
            expiresInSeconds?: number;
            user: AuthSession['user'];
          };
          error?: string;
        }
      | undefined;
    if (!ipcResponse?.ok || !ipcResponse.session) {
      throw new Error(ipcResponse?.error ?? 'login_failed');
    }
    const session = normalizeSession(ipcResponse.session);
    await writeStoredSession(session);
    return session;
  }

  // Web/browser fallback: direct HTTP when Electron IPC bridge is unavailable
  const data = await requestJson<{
    token: string;
    refreshToken: string;
    expiresInSeconds: number;
    user: AuthSession['user'];
  }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const session = normalizeSession(data);
  await writeStoredSession(session);
  return session;
}

export async function signup(payload: SignupPayload): Promise<AuthSession> {
  if (window.cockpit?.auth?.signup) {
    const ipcResponse = (await window.cockpit.auth.signup(payload)) as
      | {
          ok: boolean;
          session?: {
            token: string;
            refreshToken: string;
            expiresAtMs?: number;
            expiresInSeconds?: number;
            user: AuthSession['user'];
          };
          error?: string;
        }
      | undefined;
    if (!ipcResponse?.ok || !ipcResponse.session) {
      throw new Error(ipcResponse?.error ?? 'signup_failed');
    }
    const session = normalizeSession(ipcResponse.session);
    await writeStoredSession(session);
    return session;
  }

  // Web/browser fallback: direct HTTP when Electron IPC bridge is unavailable
  const data = await requestJson<{
    token: string;
    refreshToken: string;
    expiresInSeconds: number;
    user: AuthSession['user'];
  }>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const session = normalizeSession(data);
  await writeStoredSession(session);
  return session;
}

export async function refresh(refreshToken: string): Promise<AuthSession> {
  const existing = await readStoredSession();
  if (!existing || existing.refreshToken !== refreshToken) {
    throw new Error('refresh_session_mismatch');
  }

  // Try IPC bridge first
  if (window.cockpit?.auth?.refresh) {
    const ipcResponse = (await window.cockpit.auth.refresh()) as
      | {
          ok: boolean;
          session?: {
            token: string;
            refreshToken: string;
            expiresAtMs?: number;
            expiresInSeconds?: number;
            user: AuthSession['user'];
          };
          error?: string;
        }
      | undefined;
    if (!ipcResponse?.ok || !ipcResponse.session) {
      throw new Error(ipcResponse?.error ?? 'refresh_failed');
    }
    const session = normalizeSession(ipcResponse.session);
    await writeStoredSession(session);
    return session;
  }

  // Web/browser fallback: direct HTTP token refresh
  const data = await requestJson<{
    token: string;
    refreshToken: string;
    expiresInSeconds: number;
    user: AuthSession['user'];
  }>('/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
  const session = normalizeSession(data);
  await writeStoredSession(session);
  return session;
}

export async function ensureSession(): Promise<AuthSession> {
  const current = await readStoredSession();
  const now = Date.now();

  if (current && current.expiresAtMs - now > 30_000) {
    return current;
  }

  if (current?.refreshToken) {
    return refresh(current.refreshToken);
  }

  const devAutoLoginEnabled =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      ?.VITE_TC_DEV_AUTO_LOGIN === 'true';
  if (!devAutoLoginEnabled) {
    throw new Error('authentication_required');
  }

  const email =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      ?.VITE_TC_BOOTSTRAP_EMAIL ?? '';
  const username = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_TC_BOOTSTRAP_USERNAME;
  const password =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      ?.VITE_TC_BOOTSTRAP_PASSWORD ?? '';
  const licenseKey =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      ?.VITE_TC_BOOTSTRAP_LICENSE_KEY ?? '';

  return login({ email, username, password, licenseKey });
}

export function getBackendBaseWsUrl() {
  return getBackendBaseUrl().replace(/^http/i, 'ws');
}

/**
 * Silently probes whether a token is accepted by the backend.
 * Returns: true = valid, false = rejected (401/403), null = backend unreachable.
 * Does NOT dispatch tc:session-expired — only for bootstrap validation.
 * Must use a non-/api/auth/* path so the authSessionStore middleware runs.
 */
export async function probeSessionValid(token: string): Promise<boolean | null> {
  try {
    const res = await fetch(toUrl('/api/ai/research/status'), {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401 || res.status === 403) return false;
    return true;
  } catch {
    return null; // network error / backend not running
  }
}

export async function authGet<T>(path: string): Promise<T> {
  const session = await ensureSession();
  return requestJson<T>(path, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`,
    },
  });
}

export async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await ensureSession();
  return requestJson<T>(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(init.headers ?? {}),
    },
  });
}
