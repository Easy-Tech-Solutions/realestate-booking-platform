import { createServer } from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { loadAppModules } from './lib/apps.js';
import { logger } from './lib/logger.js';
import { handleUpgrade } from './lib/ws.js';

const app = await createApp();
await loadAppModules('ws');
const server = createServer(app);
server.on('upgrade', handleUpgrade);
server.listen(config.port, '0.0.0.0', () => logger.info({ port: config.port }, 'express-api listening'));

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
