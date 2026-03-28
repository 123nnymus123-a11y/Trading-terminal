import { z } from "zod";

// z.coerce.boolean() uses Boolean() which treats "false" as true (non-empty string).
// Use a preprocessor that correctly maps "false"/"0"/"" to false.
const envBool = (defaultVal: boolean) =>
  z
    .preprocess((val) => {
      if (typeof val === "boolean") return val;
      if (typeof val === "string") return val === "true" || val === "1";
      return defaultVal;
    }, z.boolean())
    .default(defaultVal);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  CORS_ORIGIN: z.string().default("*"),
  JWT_SECRET: z.string().min(12).default("dev-only-change-me"),
  JWT_EXPIRES_SECONDS: z.coerce.number().int().positive().default(3600),
  JWT_REFRESH_EXPIRES_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(86400),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(900),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(1209600),
  AUTH_REQUIRE_2FA_FOR_ROLES: z
    .string()
    .default("admin,operator")
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  AUTH_SESSION_STORE_ENABLED: envBool(false),
  AUTH_REFRESH_ROTATION_ENABLED: envBool(false),
  AUTH_RBAC_ENFORCED: envBool(false),
  AUTH_TOTP_REQUIRED: envBool(false),
  WS_REVOCATION_CHECKS_ENABLED: envBool(false),
  IPC_STRICT_ALLOWLIST_ENABLED: envBool(false),
  AUTH_BOOTSTRAP_EMAIL: z.string().email().default("demo@tradingcockpit.dev"),
  AUTH_BOOTSTRAP_USERNAME: z.string().min(3).default("demo"),
  AUTH_BOOTSTRAP_PASSWORD: z.string().min(8).default("ChangeMe123!"),
  AUTH_BOOTSTRAP_LICENSE_KEY: z.string().min(1).default("007"),
  AUTH_EMAIL_ENABLED: envBool(false),
  AUTH_EMAIL_FROM: z.string().email().optional(),
  AUTH_EMAIL_SMTP_HOST: z.string().min(1).optional(),
  AUTH_EMAIL_SMTP_PORT: z.coerce.number().int().positive().optional(),
  AUTH_EMAIL_SMTP_SECURE: envBool(false),
  AUTH_EMAIL_SMTP_USER: z.string().min(1).optional(),
  AUTH_EMAIL_SMTP_PASS: z.string().min(1).optional(),
  AUTH_EMAIL_VERIFY_BASE_URL: z
    .string()
    .url()
    .default("http://localhost:5173/auth/verify"),
  WS_BATCH_INTERVAL_MS: z.coerce.number().int().positive().default(100),
  WS_QUEUE_LIMIT: z.coerce.number().int().positive().default(200),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(240),
  AI_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  AI_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
  CACHE_PUBLICFLOW_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  CACHE_CONGRESS_TRADES_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  CACHE_AI_BRIEFS_TTL_SECONDS: z.coerce.number().int().positive().default(20),
  CACHE_AI_PREDICTIONS_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(20),
  DEFAULT_TENANT_ID: z.string().min(1).default("default"),
  MIGRATION_BACKEND_ONLY_PROCESSING: envBool(false),
  MIGRATION_DESKTOP_LOCAL_FALLBACK: envBool(true),
  MIGRATION_WEB_PRIMARY_ROUTING: envBool(false),
  MIGRATION_REQUIRE_TENANT_HEADER: envBool(false),
  AI_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(2),
  AI_QUEUE_MAX: z.coerce.number().int().positive().default(50),
  AI_QUEUE_RETRY_LIMIT: z.coerce.number().int().positive().default(2),
  AI_QUEUE_JOB_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  AI_RESEARCH_WAIT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(45000),
  OLLAMA_CLOUD_ENDPOINT: z.string().url().default("http://127.0.0.1:11434/api"),
  OLLAMA_CLOUD_API_KEY: z.string().min(16).optional(),
  OLLAMA_API_KEY: z.string().min(16).optional(),
  OLLAMA_DEFAULT_MODEL: z.string().min(1).default("gemma3:27b"),
  OLLAMA_SECONDARY_MODEL: z.string().min(1).optional(),
  OLLAMA_TERTIARY_MODEL: z.string().min(1).optional(),
  OLLAMA_RESEARCH_MODEL: z.string().min(1).optional(),
  OLLAMA_CONGRESS_MODEL: z.string().min(1).optional(),
  OLLAMA_SUPPLY_CHAIN_MODEL: z.string().min(1).optional(),
  OLLAMA_STEWARD_MODEL: z.string().min(1).optional(),
  OLLAMA_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  TED_LIVE_ENABLED: envBool(false),
  TED_LIVE_BASE_URL: z.string().url().optional(),
  TED_LIVE_API_KEY: z.string().min(1).optional(),
  TED_LIVE_AUTH_HEADER: z.string().min(1).default("x-api-key"),
  TED_LIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  TED_LIVE_WINDOW_QUERY_PARAM: z.string().min(1).default("window"),
  OPENAI_API_KEY: z.string().min(16).optional(),
  GOOGLE_GEMINI_API_KEY: z.string().min(16).optional(),
  MICROSOFT_COPILOT_API_KEY: z.string().min(16).optional(),
  ANTHROPIC_API_KEY: z.string().min(16).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.errors
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid backend environment configuration: ${details}`);
  }
  return parsed.data;
}
