import type { Request, Response, NextFunction } from "express";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { AppEnv } from "./config.js";
import { createLogger } from "./logger.js";
import {
  addUserWatchlist,
  cancelOrder,
  getAccount,
  getOrders,
  getPositions,
  getUserSettings,
  listUserWatchlists,
  placeOrder,
  removeUserWatchlist,
  updateUserSettings,
  updateUserWatchlist,
  type Order,
} from "./domainStore.js";

const logger = createLogger("infra");

type Position = {
  symbol: string;
  qty: number;
  avgPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
};

type Account = {
  balance: number;
  equity: number;
  buyingPower: number;
  dailyPnl: number;
  dailyPnlPercent: number;
};

type StorageAdapter = {
  mode: "memory" | "postgres";
  getSettings: (
    userId: string,
    tenantId?: string,
  ) => Promise<Record<string, unknown>>;
  updateSettings: (
    userId: string,
    next: Record<string, unknown>,
    tenantId?: string,
  ) => Promise<Record<string, unknown>>;
  listWatchlists: (
    userId: string,
    tenantId?: string,
  ) => Promise<Array<{ id: number; symbol: string; note: string }>>;
  addWatchlist: (
    userId: string,
    symbol: string,
    note?: string,
    tenantId?: string,
  ) => Promise<{ id: number; symbol: string; note: string }>;
  updateWatchlist: (
    userId: string,
    id: number,
    fields: { symbol?: string; note?: string },
    tenantId?: string,
  ) => Promise<{ id: number; symbol: string; note: string } | null>;
  removeWatchlist: (
    userId: string,
    id: number,
    tenantId?: string,
  ) => Promise<boolean>;
  getOrders: (userId: string, tenantId?: string) => Promise<Order[]>;
  getPositions: (userId: string, tenantId?: string) => Promise<Position[]>;
  getAccount: (userId: string, tenantId?: string) => Promise<Account>;
  placeOrder: (
    userId: string,
    req: {
      symbol: string;
      side: "BUY" | "SELL";
      qty: number;
      type: string;
      limitPrice?: number;
      stopPrice?: number;
    },
    tenantId?: string,
  ) => Promise<Order>;
  cancelOrder: (
    userId: string,
    orderId: string,
    tenantId?: string,
  ) => Promise<boolean>;
};

type CacheAdapter = {
  mode: "memory" | "redis";
  getJson: <T>(key: string) => Promise<T | null>;
  setJson: <T>(key: string, value: T, ttlSeconds: number) => Promise<void>;
  incrementRateKey: (key: string, ttlSeconds: number) => Promise<number>;
  deleteKey: (key: string) => Promise<void>;
};

class MemoryCache implements CacheAdapter {
  readonly mode = "memory" as const;
  private store = new Map<string, { value: string; expiresAt: number }>();

  async getJson<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return JSON.parse(hit.value) as T;
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async incrementRateKey(key: string, ttlSeconds: number): Promise<number> {
    const current = await this.getJson<number>(key);
    const next = (current ?? 0) + 1;
    await this.setJson(key, next, ttlSeconds);
    return next;
  }

  async deleteKey(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class RedisCache implements CacheAdapter {
  readonly mode = "redis" as const;
  constructor(
    private readonly redis: {
      get: (key: string) => Promise<string | null>;
      set: (...args: unknown[]) => Promise<unknown>;
      incr: (key: string) => Promise<number>;
      expire: (key: string, ttl: number) => Promise<unknown>;
      del: (key: string) => Promise<number>;
    },
  ) {}

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  async incrementRateKey(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, ttlSeconds);
    }
    return count;
  }

  async deleteKey(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "migrations"),
    path.resolve(process.cwd(), "apps/backend/migrations"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations"),
  ];
  return candidates[0] ?? path.resolve(process.cwd(), "migrations");
}

async function applyMigrations(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = resolveMigrationsDir();
  let files: string[] = [];
  try {
    files = (await readdir(migrationsDir))
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    logger.warn("migrations_directory_unavailable", { migrationsDir, error });
    return;
  }

  for (const fileName of files) {
    const version = fileName;
    const alreadyApplied = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [version],
    );
    if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, fileName), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [version],
      );
      await client.query("COMMIT");
      logger.info("migration_applied", { version });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function createPostgresStorage(
  databaseUrl: string,
): Promise<{
  storage: StorageAdapter;
  pool: Pool;
  close: () => Promise<void>;
}> {
  const pool = new Pool({ connectionString: databaseUrl });
  await applyMigrations(pool);

  const resolveTenant = (tenantId?: string) => tenantId?.trim() || "default";
  const scopedUserId = (userId: string, tenantId?: string) =>
    `${resolveTenant(tenantId)}:${userId}`;

  async function ensureUserInitialized(userId: string, tenantId?: string) {
    const tenant = resolveTenant(tenantId);
    const scopedUser = scopedUserId(userId, tenant);
    await pool.query(
      "INSERT INTO user_profiles (user_id, tenant_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING",
      [scopedUser, tenant],
    );
    await pool.query(
      `INSERT INTO user_settings (user_id, tenant_id, settings)
       VALUES ($1, $2, '{}'::jsonb)
       ON CONFLICT (user_id) DO NOTHING`,
      [scopedUser, tenant],
    );
    await pool.query(
      `INSERT INTO accounts (user_id, tenant_id, balance, equity, buying_power, daily_pnl, daily_pnl_percent)
       VALUES ($1, $2, 100000, 100000, 200000, 0, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [scopedUser, tenant],
    );

    const watchlistCount = await pool.query(
      "SELECT COUNT(*)::int AS count FROM watchlists WHERE user_id = $1 AND tenant_id = $2",
      [scopedUser, tenant],
    );
    const count = Number(watchlistCount.rows[0]?.count ?? 0);
    if (count === 0) {
      await pool.query(
        "INSERT INTO watchlists (user_id, tenant_id, symbol, note) VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)",
        [scopedUser, tenant, "AAPL", "Core tech", "MSFT", "Cloud"],
      );
    }
  }

  function mapOrderRow(row: {
    order_id: string;
    symbol: string;
    side: "BUY" | "SELL";
    qty: number;
    type: string;
    limit_price: number | null;
    stop_price: number | null;
    status: "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
    filled_qty: number;
    avg_fill_price: number;
    created_at: number;
    updated_at: number;
  }): Order {
    return {
      orderId: row.order_id,
      symbol: row.symbol,
      side: row.side,
      qty: Number(row.qty),
      type: row.type,
      ...(row.limit_price !== null
        ? { limitPrice: Number(row.limit_price) }
        : {}),
      ...(row.stop_price !== null ? { stopPrice: Number(row.stop_price) } : {}),
      status: row.status,
      filledQty: Number(row.filled_qty),
      avgFillPrice: Number(row.avg_fill_price),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  const storage: StorageAdapter = {
    mode: "postgres",
    getSettings: async (userId, tenantId) => {
      const tenant = resolveTenant(tenantId);
      const scopedUser = scopedUserId(userId, tenant);
      await ensureUserInitialized(userId, tenant);
      const result = await pool.query<{ settings: Record<string, unknown> }>(
        "SELECT settings FROM user_settings WHERE user_id = $1 AND tenant_id = $2",
        [scopedUser, tenant],
      );
      return result.rows[0]?.settings ?? {};
    },
    updateSettings: async (userId, next, tenantId) => {
      const tenant = resolveTenant(tenantId);
      const scopedUser = scopedUserId(userId, tenant);
      await ensureUserInitialized(userId, tenant);
      const result = await pool.query<{ settings: Record<string, unknown> }>(
        `UPDATE user_settings
         SET settings = settings || $2::jsonb,
             updated_at = NOW()
         WHERE user_id = $1 AND tenant_id = $3
         RETURNING settings`,
        [scopedUser, JSON.stringify(next), tenant],
      );
      return result.rows[0]?.settings ?? {};
    },
    listWatchlists: async (userId, tenantId) => {
      const tenant = resolveTenant(tenantId);
      const scopedUser = scopedUserId(userId, tenant);
      await ensureUserInitialized(userId, tenant);
      const result = await pool.query<{
        id: number;
        symbol: string;
        note: string;
      }>(
        "SELECT id, symbol, note FROM watchlists WHERE user_id = $1 AND tenant_id = $2 ORDER BY id ASC",
        [scopedUser, tenant],
      );
      return result.rows;
    },
    addWatchlist: async (userId, symbol, note = "", tenantId) => {
      const tenant = resolveTenant(tenantId);
      const scopedUser = scopedUserId(userId, tenant);
      await ensureUserInitialized(userId, tenant);
      const result = await pool.query<{
        id: number;
        symbol: string;
        note: string;
      }>(
        `INSERT INTO watchlists (user_id, tenant_id, symbol, note)
         VALUES ($1, $2, $3, $4)
         RETURNING id, symbol, note`,
        [scopedUser, tenant, symbol.toUpperCase(), note],
      );
      return result.rows[0]!;
    },
    updateWatchlist: async (userId, id, fields, tenantId) => {
      const tenant = resolveTenant(tenantId);
      const scopedUser = scopedUserId(userId, tenant);
      await ensureUserInitialized(userId, tenant);
      const result = await pool.query<{
        id: number;
        symbol: string;
        note: string;
      }>(
        `UPDATE watchlists
         SET symbol = COALESCE($3, symbol),
             note = COALESCE($4, note),
             updated_at = NOW()
         WHERE user_id = $1 AND id = $2 AND tenant_id = $5
         RETURNING id, symbol, note`,
        [
          scopedUser,
          id,
          fields.symbol ? fields.symbol.toUpperCase() : null,
          fields.note ?? null,
          tenant,
        ],
      );
      return result.rows[0] ?? null;
    },
    removeWatchlist: async (userId, id, tenantId) => {
      const tenant = resolveTenant(tenantId);
      const scopedUser = scopedUserId(userId, tenant);
      await ensureUserInitialized(userId, tenant);
      const result = await pool.query(
        "DELETE FROM watchlists WHERE user_id = $1 AND id = $2 AND tenant_id = $3",
        [scopedUser, id, tenant],
      );
      return (result.rowCount ?? 0) > 0;
    },
    getOrders: async (userId, tenantId) => {
      const tenant = resolveTenant(tenantId);
      const scopedUser = scopedUserId(userId, tenant);
      await ensureUserInitialized(userId, tenant);
      const result = await pool.query<{
        order_id: string;
        symbol: string;
        side: "BUY" | "SELL";
        qty: number;
        type: string;
        limit_price: number | null;
        stop_price: number | null;
        status: "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
        filled_qty: number;
        avg_fill_price: number;
        created_at: number;
        updated_at: number;
      }>(
        `SELECT order_id, symbol, side, qty, type, limit_price, stop_price, status,
                filled_qty, avg_fill_price, created_at, updated_at
         FROM orders
         WHERE user_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC`,
        [scopedUser, tenant],
      );
      return result.rows.map((row) => mapOrderRow(row));
    },
    getPositions: async (userId, tenantId) => {
      const tenant = resolveTenant(tenantId);
      const scopedUser = scopedUserId(userId, tenant);
      await ensureUserInitialized(userId, tenant);
      const result = await pool.query<{
        symbol: string;
        qty: number;
        avg_price: number;
        unrealized_pnl: number;
        realized_pnl: number;
      }>(
        `SELECT symbol, qty, avg_price, unrealized_pnl, realized_pnl
         FROM positions
         WHERE user_id = $1 AND tenant_id = $2
         ORDER BY symbol ASC`,
        [scopedUser, tenant],
      );
      return result.rows.map((row) => ({
        symbol: row.symbol,
        qty: Number(row.qty),
        avgPrice: Number(row.avg_price),
        unrealizedPnl: Number(row.unrealized_pnl),
        realizedPnl: Number(row.realized_pnl),
      }));
    },
    getAccount: async (userId, tenantId) => {
      const tenant = resolveTenant(tenantId);
      const scopedUser = scopedUserId(userId, tenant);
      await ensureUserInitialized(userId, tenant);
      const result = await pool.query<{
        balance: number;
        equity: number;
        buying_power: number;
        daily_pnl: number;
        daily_pnl_percent: number;
      }>(
        `SELECT balance, equity, buying_power, daily_pnl, daily_pnl_percent
         FROM accounts
         WHERE user_id = $1 AND tenant_id = $2`,
        [scopedUser, tenant],
      );
      const row = result.rows[0];
      if (!row) {
        return {
          balance: 100000,
          equity: 100000,
          buyingPower: 200000,
          dailyPnl: 0,
          dailyPnlPercent: 0,
        };
      }
      return {
        balance: Number(row.balance),
        equity: Number(row.equity),
        buyingPower: Number(row.buying_power),
        dailyPnl: Number(row.daily_pnl),
        dailyPnlPercent: Number(row.daily_pnl_percent),
      };
    },
    placeOrder: async (userId, req, tenantId) => {
      const tenant = resolveTenant(tenantId);
      const scopedUser = scopedUserId(userId, tenant);
      await ensureUserInitialized(userId, tenant);
      const now = Date.now();
      const order: Order = {
        orderId: `ord-${tenant}-${userId}-${now}`,
        symbol: req.symbol.toUpperCase(),
        side: req.side,
        qty: req.qty,
        type: req.type,
        ...(req.limitPrice !== undefined ? { limitPrice: req.limitPrice } : {}),
        ...(req.stopPrice !== undefined ? { stopPrice: req.stopPrice } : {}),
        status: "FILLED",
        filledQty: req.qty,
        avgFillPrice:
          req.limitPrice ?? Number((100 + Math.random() * 100).toFixed(2)),
        createdAt: now,
        updatedAt: now,
      };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO orders (
             order_id, user_id, symbol, side, qty, type, limit_price, stop_price,
             status, filled_qty, avg_fill_price, created_at, updated_at, tenant_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, $12, $13, $14
           )`,
          [
            order.orderId,
            scopedUser,
            order.symbol,
            order.side,
            order.qty,
            order.type,
            order.limitPrice ?? null,
            order.stopPrice ?? null,
            order.status,
            order.filledQty,
            order.avgFillPrice,
            order.createdAt,
            order.updatedAt,
            tenant,
          ],
        );

        const signedQty = order.side === "BUY" ? order.qty : -order.qty;
        const unrealized = Number(((Math.random() - 0.5) * 500).toFixed(2));
        await client.query(
          `INSERT INTO positions (user_id, symbol, qty, avg_price, unrealized_pnl, realized_pnl, tenant_id)
           VALUES ($1, $2, $3, $4, $5, 0, $6)
           ON CONFLICT (tenant_id, user_id, symbol)
           DO UPDATE SET
             qty = positions.qty + EXCLUDED.qty,
             avg_price = EXCLUDED.avg_price,
             unrealized_pnl = EXCLUDED.unrealized_pnl`,
          [
            scopedUser,
            order.symbol,
            signedQty,
            order.avgFillPrice,
            unrealized,
            tenant,
          ],
        );

        const accountResult = await client.query<{
          balance: number;
          equity: number;
          daily_pnl: number;
          daily_pnl_percent: number;
        }>(
          "SELECT balance, equity, daily_pnl, daily_pnl_percent FROM accounts WHERE user_id = $1 AND tenant_id = $2 FOR UPDATE",
          [scopedUser, tenant],
        );
        const account = accountResult.rows[0] ?? {
          balance: 100000,
          equity: 100000,
          daily_pnl: 0,
          daily_pnl_percent: 0,
        };
        const notional = order.avgFillPrice * order.qty;
        const cashDelta = order.side === "BUY" ? -notional : notional;
        await client.query(
          `UPDATE accounts
           SET balance = $2,
               equity = $3,
               daily_pnl = $4,
               daily_pnl_percent = $5,
               updated_at = NOW()
           WHERE user_id = $1 AND tenant_id = $6`,
          [
            scopedUser,
            Number((Number(account.balance) + cashDelta).toFixed(2)),
            Number(
              (Number(account.equity) + Math.random() * 100 - 50).toFixed(2),
            ),
            Number(
              (Number(account.daily_pnl) + Math.random() * 50 - 25).toFixed(2),
            ),
            Number(
              (
                Number(account.daily_pnl_percent) +
                (Math.random() - 0.5) * 0.5
              ).toFixed(2),
            ),
            tenant,
          ],
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return order;
    },
    cancelOrder: async (userId, orderId, tenantId) => {
      const tenant = resolveTenant(tenantId);
      const scopedUser = scopedUserId(userId, tenant);
      await ensureUserInitialized(userId, tenant);
      const result = await pool.query(
        `UPDATE orders
         SET status = 'CANCELLED',
             updated_at = $3
         WHERE user_id = $1 AND order_id = $2 AND tenant_id = $4`,
        [scopedUser, orderId, Date.now(), tenant],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };

  return {
    storage,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

function createMemoryStorage(): StorageAdapter {
  return {
    mode: "memory",
    getSettings: async (userId) => getUserSettings(userId),
    updateSettings: async (userId, next) => updateUserSettings(userId, next),
    listWatchlists: async (userId) => listUserWatchlists(userId),
    addWatchlist: async (userId, symbol, note) =>
      addUserWatchlist(userId, symbol, note),
    updateWatchlist: async (userId, id, fields) =>
      updateUserWatchlist(userId, id, fields),
    removeWatchlist: async (userId, id) => removeUserWatchlist(userId, id),
    getOrders: async (userId) => getOrders(userId),
    getPositions: async (userId) => getPositions(userId),
    getAccount: async (userId) => getAccount(userId),
    placeOrder: async (userId, req) => placeOrder(userId, req),
    cancelOrder: async (userId, orderId) => cancelOrder(userId, orderId),
  };
}

export type BackendInfra = {
  storage: StorageAdapter;
  cache: CacheAdapter;
  rateLimitMiddleware: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<void>;
  meta: { storageMode: "memory" | "postgres"; cacheMode: "memory" | "redis" };
  pool: Pool | null;
  close: () => Promise<void>;
};

export async function createInfra(env: AppEnv): Promise<BackendInfra> {
  let storage = createMemoryStorage();
  let closeStorage: () => Promise<void> = async () => {};
  let pgPool: Pool | null = null;

  if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production");
  }

  if (env.DATABASE_URL) {
    try {
      const pgStorage = await createPostgresStorage(env.DATABASE_URL);
      storage = pgStorage.storage;
      closeStorage = pgStorage.close;
      pgPool = pgStorage.pool;
      logger.info("postgres_storage_enabled");
    } catch (error) {
      if (env.NODE_ENV === "production") {
        throw new Error(
          `postgres_storage_required_in_production: ${error instanceof Error ? error.message : "unknown_error"}`,
        );
      }
      logger.warn("postgres_storage_fallback_to_memory", error);
    }
  }

  let cache: CacheAdapter = new MemoryCache();
  let closeRedis: () => Promise<void> = async () => {};

  if (env.REDIS_URL) {
    try {
      const ioredis = await import("ioredis");
      const RedisCtor = (
        ioredis as unknown as {
          Redis: new (
            url: string,
            options?: Record<string, unknown>,
          ) => {
            connect: () => Promise<void>;
            quit: () => Promise<void>;
            get: (key: string) => Promise<string | null>;
            set: (...args: unknown[]) => Promise<unknown>;
            incr: (key: string) => Promise<number>;
            expire: (key: string, ttl: number) => Promise<unknown>;
            del: (key: string) => Promise<number>;
          };
        }
      ).Redis;
      const redis = new RedisCtor(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await redis.connect();
      cache = new RedisCache(redis);
      closeRedis = async () => {
        await redis.quit();
      };
      logger.info("redis_cache_enabled");
    } catch (error) {
      logger.warn("redis_cache_fallback_to_memory", error);
    }
  }

  const rateLimitMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (req.path === "/health" || req.path === "/metrics") {
      next();
      return;
    }

    const windowBucket = Math.floor(
      Date.now() / (env.RATE_LIMIT_WINDOW_SECONDS * 1000),
    );
    const key = `rate:${req.ip ?? "unknown"}:${windowBucket}`;
    const count = await cache.incrementRateKey(
      key,
      env.RATE_LIMIT_WINDOW_SECONDS,
    );

    if (count > env.RATE_LIMIT_MAX_REQUESTS) {
      res
        .status(429)
        .json({
          error: "rate_limited",
          retryAfterSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
        });
      return;
    }

    next();
  };

  return {
    storage,
    cache,
    rateLimitMiddleware,
    pool: pgPool,
    meta: { storageMode: storage.mode, cacheMode: cache.mode },
    close: async () => {
      await closeStorage();
      await closeRedis();
    },
  };
}
