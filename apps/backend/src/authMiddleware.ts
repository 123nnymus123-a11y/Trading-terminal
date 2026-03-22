import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from './auth.js';

export type RequestTenantContext = {
  tenantId: string;
  source: 'header' | 'default' | 'user';
};

export type AccessVerifier = (token: string) => AuthUser | null;

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      tenantContext?: RequestTenantContext;
    }
  }
}

function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }
  return token;
}

export function requireAuth(verifyAccessToken: AccessVerifier) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token' });
      return;
    }

    const user = verifyAccessToken(token);
    if (!user) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
      return;
    }

    req.user = user;
    next();
  };
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  return getBearerToken(authHeader);
}

export function requireRoles(requiredRoles: AuthUser['roles'], options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const roleSet = new Set(requiredRoles);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled) {
      next();
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const hasRole = req.user.roles.some((role) => roleSet.has(role));
    if (!hasRole) {
      res.status(403).json({ error: 'forbidden', message: 'insufficient_role' });
      return;
    }

    next();
  };
}

export function attachTenantContext(defaultTenantId: string, requireHeader = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    const headerTenantIdRaw = req.headers['x-tenant-id'] ?? req.headers['x-org-id'];
    const headerTenantId =
      typeof headerTenantIdRaw === 'string' && headerTenantIdRaw.trim().length > 0
        ? headerTenantIdRaw.trim()
        : null;

    if (requireHeader && !headerTenantId) {
      res.status(400).json({ error: 'tenant_required', message: 'Missing x-tenant-id header' });
      return;
    }

    req.tenantContext = {
      tenantId: headerTenantId ?? defaultTenantId,
      source: headerTenantId ? 'header' : 'default',
    };

    next();
  };
}
