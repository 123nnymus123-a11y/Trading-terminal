import { z } from 'zod';

export const authTierSchema = z.enum(['starter', 'pro', 'enterprise']);

export const authRoleSchema = z.enum(['admin', 'operator', 'analyst', 'viewer', 'service']);

export const authSessionStatusSchema = z.enum(['active', 'revoked', 'expired', 'pending_2fa']);

export const authFactorTypeSchema = z.enum(['totp', 'recovery_code']);

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  username: z.string(),
  tier: authTierSchema,
  roles: z.array(authRoleSchema).default(['viewer']),
  licenseKey: z.string(),
});

export const authAccessClaimsSchema = z.object({
  sub: z.string(),
  sid: z.string(),
  jti: z.string(),
  email: z.string().email(),
  username: z.string(),
  tier: authTierSchema,
  roles: z.array(authRoleSchema),
  amr: z.array(z.string()).default(['pwd']),
  twoFactorVerified: z.boolean().default(false),
  type: z.literal('access'),
});

export const authRefreshClaimsSchema = z.object({
  sub: z.string(),
  sid: z.string(),
  jti: z.string(),
  type: z.literal('refresh'),
});

export const loginRequestSchema = z
  .object({
    email: z.string().email().optional(),
    username: z.string().min(3).optional(),
    password: z.string().min(8),
    licenseKey: z.string().min(8),
  })
  .refine((value) => Boolean(value.email || value.username), {
    message: 'email_or_username_required',
    path: ['email'],
  });

export const loginResponseSchema = z.object({
  token: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
  user: authUserSchema,
});

export const refreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(12),
});

export const logoutRequestSchema = z
  .object({
    refreshToken: z.string().min(12).optional(),
    allSessions: z.boolean().optional(),
  })
  .default({});

export const meResponseSchema = z.object({
  user: authUserSchema,
});

export type AuthRole = z.infer<typeof authRoleSchema>;
export type AuthTier = z.infer<typeof authTierSchema>;
export type AuthSessionStatus = z.infer<typeof authSessionStatusSchema>;
export type AuthFactorType = z.infer<typeof authFactorTypeSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
