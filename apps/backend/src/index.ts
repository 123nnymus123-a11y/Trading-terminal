import 'dotenv/config';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from './server.js';

// Prevent unhandled promise rejections from crashing the server
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Caught unhandled rejection (server kept alive):', reason);
});
import { attachWebSocket } from './wsHub.js';
import { readEnv } from './config.js';
import { createLogger } from './logger.js';
import { createAuthService } from './auth.js';
import { createInfra } from './infra.js';

const logger = createLogger('bootstrap');
const pkgVersion = '0.0.1';

async function main() {
  const env = readEnv();
  const auth = createAuthService(env);
  const infra = await createInfra(env);
  let readWsMetrics = () => ({
    connectedClients: 0,
    totalMessagesSent: 0,
    totalMessagesDropped: 0,
  });
  const app = createServer(pkgVersion, env, () => readWsMetrics(), infra);
  const server = createHttpServer(app);
  const ws = attachWebSocket(server, auth.verifyAccessToken, env);
  readWsMetrics = ws.readMetrics;

  const shutdown = async () => {
    logger.info('backend_shutdown_start');
    await infra.close();
    server.close(() => {
      logger.info('backend_shutdown_complete');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  server.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`backend_listening:${env.PORT}`);
  });
}

main().catch((error) => {
  logger.error('backend_boot_failed', error);
  process.exitCode = 1;
});
