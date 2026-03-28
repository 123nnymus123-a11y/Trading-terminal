type Level = "info" | "warn" | "error";

function write(level: Level, scope: string, message: string, meta?: unknown) {
  const base = `[${new Date().toISOString()}] [${level}] [backend:${scope}] ${message}`;
  if (meta === undefined) {
    console[level](base);
    return;
  }
  console[level](base, meta);
}

export function createLogger(scope: string) {
  return {
    info: (message: string, meta?: unknown) => write("info", scope, message, meta),
    warn: (message: string, meta?: unknown) => write("warn", scope, message, meta),
    error: (message: string, meta?: unknown) => write("error", scope, message, meta),
  };
}
