import { buildApp } from './app.js';
import { loadConfig } from './config.js';

/** 優雅關閉的最長等待時間；Cloud Run 與 docker stop 預設都是 10 秒後強制砍掉。 */
const FORCE_EXIT_MS = 8_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const { fastify, cardSetInfos } = buildApp(config);
  fastify.log.info({ cardSets: cardSetInfos.map((c) => c.id) }, '已載入卡牌組');

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    fastify.log.info({ signal }, '收到結束訊號，開始優雅關閉');
    // 保險：萬一關閉卡住，到時間就強制結束（Cloud Run 在 SIGTERM 後只給 10 秒）
    setTimeout(() => {
      console.error('優雅關閉逾時，強制結束');
      process.exit(1);
    }, FORCE_EXIT_MS).unref();
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
