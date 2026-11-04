import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { fastify } = buildApp(config);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    fastify.log.info({ signal }, '收到結束訊號，開始優雅關閉');
    fastify
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('關閉時發生錯誤', error);
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await fastify.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error('伺服器啟動失敗', error);
  process.exit(1);
});
