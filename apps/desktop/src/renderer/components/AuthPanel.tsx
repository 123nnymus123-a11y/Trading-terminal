import React, { useState, useEffect } from 'react';
import type { AuthSession, LoginPayload, SignupPayload } from '../lib/apiClient';
import { getBackendBaseUrl, refreshBackendBaseUrl } from '../lib/apiClient';

type Props = {
  onLogin: (payload: LoginPayload) => Promise<AuthSession>;
  onSignup: (payload: SignupPayload) => Promise<AuthSession>;
  onAuthenticated: (session: AuthSession) => void;
  initialError?: string | null;
};

type AuthTab = 'login' | 'signup';
type HealthStatus = 'checking' | 'online' | 'offline';

const DEFAULT_LICENSE_KEY =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_TC_BOOTSTRAP_LICENSE_KEY ?? '007';

function parseAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'auth_failed';
  if (
    message.includes('fetch') ||
    message.includes('ECONNREFUSED') ||
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('net::ERR') ||
    message.includes('connection refused')
  ) {
    return 'Cannot reach backend server.';
  }
  if (message.includes('409') || message.includes('identity_exists')) {
    return 'Account already exists. Please sign in.';
  }
  if (message.includes('invalid_license_key')) {
    return 'Invalid license key.';
  }
  if (message.includes('401') || message.includes('invalid_credentials')) {
    return 'Invalid credentials.';
  }
  if (message.includes('503') || message.includes('auth_store_unavailable')) {
    return 'Authentication service unavailable. Is the database running?';
  }
  if (message.includes('invalid_signup_payload')) {
    return 'All fields are required.';
  }
  if (message.includes('invalid_request')) {
    return 'Check your details (email, username, password 8+ chars, license key).';
  }
  return `Authentication failed: ${message}`;
}

function useHealthCheck(backendUrl: string): HealthStatus {
  const [status, setStatus] = useState<HealthStatus>('checking');
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${backendUrl}/health`, { signal: controller.signal });
        clearTimeout(timer);
        if (!cancelled) setStatus(res.ok ? 'online' : 'offline');
      } catch {
        if (!cancelled) setStatus('offline');
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [backendUrl]);
  return status;
}

const SEP = '═'.repeat(48);

export function AuthPanel({ onLogin, onSignup, onAuthenticated, initialError }: Props) {
  const [tab, setTab] = useState<AuthTab>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLicenseKey, setLoginLicenseKey] = useState(DEFAULT_LICENSE_KEY);

  const [signupEmail, setSignupEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupLicenseKey, setSignupLicenseKey] = useState(DEFAULT_LICENSE_KEY);

  const [backendUrl, setBackendUrl] = useState(getBackendBaseUrl);
  useEffect(() => {
    void refreshBackendBaseUrl().then(setBackendUrl);
  }, []);
  const health = useHealthCheck(backendUrl);

  const switchTab = (next: AuthTab) => {
    setTab(next);
    setError(null);
  };

  const submitLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // DEV BYPASS: If license key is '007', skip auth and go straight to terminal
      if (
        loginLicenseKey.trim() === '007' &&
        (import.meta.env?.MODE === 'development' || process.env.NODE_ENV !== 'production')
      ) {
        const mockSession = {
          token: 'dev-bypass-token',
          refreshToken: 'dev-bypass-refresh',
          expiresAtMs: Date.now() + 1000 * 60 * 60 * 24,
          user: {
            id: 'dev-bypass-user',
            email: loginIdentifier || 'dev@bypass.local',
            username: loginIdentifier || 'devuser',
            tier: 'starter',
            licenseKey: '007',
          },
        };
        onAuthenticated(mockSession);
        return;
      }
      const identifier = loginIdentifier.trim();
      const payload: LoginPayload = {
        password: loginPassword,
        licenseKey: loginLicenseKey.trim(),
        ...(identifier.includes('@') ? { email: identifier } : { username: identifier }),
      };
      const session = await onLogin(payload);
      onAuthenticated(session);
    } catch (submitError) {
      setError(parseAuthError(submitError));
    } finally {
      setBusy(false);
    }
  };

  const submitSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await onSignup({
        email: signupEmail.trim(),
        username: signupUsername.trim(),
        password: signupPassword,
        licenseKey: signupLicenseKey.trim(),
      });
      onAuthenticated(session);
    } catch (submitError) {
      setError(parseAuthError(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="loginScreen">
      <div className="loginCard">
        {/* Bloomberg-style header block */}
        <div className="loginHeader">
          <div className="loginHeaderTitle">TRADING TERMINAL  //  AUTH</div>
          <div className="loginHeaderSep">{SEP}</div>
          <div className="loginHeaderMeta">SYSTEM: TRADING COCKPIT v2.0 &nbsp;&nbsp; &copy; 2026</div>
        </div>

        {/* Plain-text tab toggle */}
        <div className="loginTabToggle">
          <button
            type="button"
            className={tab === 'login' ? 'active' : ''}
            onClick={() => switchTab('login')}
          >
            {tab === 'login' ? '[ LOGIN ]' : '  LOGIN  '}
          </button>
          <span className="loginTabSep">/</span>
          <button
            type="button"
            className={tab === 'signup' ? 'active' : ''}
            onClick={() => switchTab('signup')}
          >
            {tab === 'signup' ? '[ CREATE ACCOUNT ]' : '  CREATE ACCOUNT  '}
          </button>
        </div>

        {tab === 'login' ? (
          <form onSubmit={submitLogin}>
            <label className="loginFieldLabel">IDENTIFIER  (EMAIL OR USERNAME)</label>
            <input
              className="loginInput"
              value={loginIdentifier}
              onChange={(e) => setLoginIdentifier(e.target.value)}
              required
              autoComplete="username"
              spellCheck={false}
            />

            <label className="loginFieldLabel">PASSWORD</label>
            <input
              className="loginInput"
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              required
              autoComplete="current-password"
            />

            <label className="loginFieldLabel">LICENSE KEY</label>
            <input
              className="loginInput"
              value={loginLicenseKey}
              onChange={(e) => setLoginLicenseKey(e.target.value)}
              required
              spellCheck={false}
            />

            <button className="loginSubmit" type="submit" disabled={busy}>
              {busy ? 'AUTHENTICATING...' : '▶  LOGIN'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitSignup}>
            <label className="loginFieldLabel">EMAIL</label>
            <input
              className="loginInput"
              type="email"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              required
              autoComplete="email"
              spellCheck={false}
            />

            <label className="loginFieldLabel">USERNAME</label>
            <input
              className="loginInput"
              value={signupUsername}
              onChange={(e) => setSignupUsername(e.target.value)}
              required
              minLength={3}
              autoComplete="username"
              spellCheck={false}
            />

            <label className="loginFieldLabel">PASSWORD  (MIN 8 CHARS)</label>
            <input
              className="loginInput"
              type="password"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />

            <label className="loginFieldLabel">LICENSE KEY</label>
            <input
              className="loginInput"
              value={signupLicenseKey}
              onChange={(e) => setSignupLicenseKey(e.target.value)}
              required
              spellCheck={false}
            />

            <button className="loginSubmit" type="submit" disabled={busy}>
              {busy ? 'CREATING ACCOUNT...' : '▶  CREATE ACCOUNT'}
            </button>
          </form>
        )}

        {error && <div className="loginError">[!] {error}</div>}

        {/* Status footer: backend URL + health ping */}
        <div className="loginStatus">
          <span className="loginStatusUrl">{backendUrl}</span>
          <span className={`loginStatusPing ${health}`}>
            {health === 'checking' ? '○ CHECKING' : health === 'online' ? '● ONLINE' : '○ OFFLINE'}
          </span>
        </div>
      </div>
    </div>
  );
}
