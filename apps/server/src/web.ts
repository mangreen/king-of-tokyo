import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * 單一容器的試玩版：由伺服器直接提供建置好的網頁。
 * - 帶雜湊檔名的 /assets/ 可長期快取；index.html 一律不快取（更新才會立即生效）
 * - SPA：沒有副檔名的 GET 路徑回到 index.html；有副檔名但不存在 → 404（不會把壞連結當成頁面）
 * - 支援預先壓縮的 .br／.gz（建置時產生），省流量與冷啟動後的首次載入時間
 * - 加上基本的安全標頭與 CSP
 */

/** 內容安全政策：只允許同源資源；WebGL 需要 blob/data 的貼圖，React 會用到行內樣式。 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function registerWeb(fastify: FastifyInstance, webDir: string): void {
  if (!existsSync(join(webDir, 'index.html'))) {
    throw new Error('WEB_DIR 底下找不到 index.html，請確認網頁已建置');
  }

  fastify.addHook('onSend', (_req, reply, payload, done) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', CSP);
    done(null, payload);
  });

  void fastify.register(fastifyStatic, {
    root: webDir,
    preCompressed: true,
    // Cache-Control 由下面的 setHeaders 決定（外掛預設的 max-age=0 會蓋掉）
    cacheControl: false,
    index: 'index.html',
    setHeaders: (res, path) => {
      const immutable = /[\\/]assets[\\/]/.test(path);
      res.setHeader(
        'Cache-Control',
        immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  fastify.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    const isPage = (req.method === 'GET' || req.method === 'HEAD') && !/\.[a-z0-9]+$/i.test(path);
    if (isPage && !path.startsWith('/socket.io')) {
      void reply
        .header('Cache-Control', 'no-cache')
        .type('text/html; charset=utf-8')
        .sendFile('index.html');
      return;
    }
    void reply.code(404).send({ error: 'not_found' });
  });
}
