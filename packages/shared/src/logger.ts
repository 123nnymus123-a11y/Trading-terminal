export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const rank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function nowIso() {
  return new Date().toISOString();
}

export function createLogger(opts: { scope: string; level?: LogLevel }) {
  const scope = opts.scope;
  const level: LogLevel = opts.level ?? 'info';
  const min = rank[level];

  function log(lvl: LogLevel, ...args: unknown[]) {
    if (rank[lvl] < min) return;
    // eslint-disable-next-line no-console
    console[lvl === 'debug' ? 'log' : lvl](`[${nowIso()}] [${lvl}] [${scope}]`, ...args);
  }

  return {
    debug: (...a: unknown[]) => log('debug', ...a),
    info: (...a: unknown[]) => log('info', ...a),
    warn: (...a: unknown[]) => log('warn', ...a),
    error: (...a: unknown[]) => log('error', ...a),
  };
}
