import { z } from 'zod';

const MainEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  TC_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TC_ENABLE_DB: z
    .union([z.literal('1'), z.literal('0')])
    .optional()
    .transform((v) => v === '1'),
  // Economic Calendar API Keys
  FRED_API_KEY: z.string().optional(),
  BLS_API_KEY: z.string().optional(),
  BEA_API_KEY: z.string().optional(),
  CENSUS_API_KEY: z.string().optional(),
  TRADING_ECONOMICS_KEY: z.string().optional(),
  TRADING_ECONOMICS_SECRET: z.string().optional(),
  FINNHUB_API_KEY: z.string().optional(),
  FINNHUB_SECRET: z.string().optional(),
  ALPHA_VANTAGE_API_KEY: z.string().optional(),
});

export type MainEnv = z.infer<typeof MainEnvSchema>;

let cached: MainEnv | null = null;

/**
 * Main-process env loader (process.env).
 * Safe to call multiple times (cached).
 */
export function getMainEnv(): MainEnv {
  if (cached) return cached;
  const parsed = MainEnvSchema.safeParse(process.env);
  cached = parsed.success ? parsed.data : { TC_LOG_LEVEL: 'info', TC_ENABLE_DB: false };
  return cached;
}
