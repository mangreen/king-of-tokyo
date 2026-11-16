import { createHash } from 'node:crypto';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { buildServiceWorker } from './src/pwa/buildSw.js';

/** 建置時產生 /sw.js：把所有建置檔案存進瀏覽器，之後沒網路也能開啟離線模式。 */
function serviceWorker(): Plugin {
  return {
    name: 'kot-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .sort();
      const version = createHash('sha1').update(files.join('\n')).digest('hex').slice(0, 10);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: buildServiceWorker(
          version,
          files.map((f) => `/${f}`),
        ),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Docker bind mount（尤其是 macOS 上的 Docker Desktop）收不到檔案事件，需用輪詢
    watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 300 } : {},
  },
  build: {
    target: 'es2022',
    // 試玩 image 不帶 sourcemap（VITE_NO_SOURCEMAP=1），縮小體積
    sourcemap: process.env['VITE_NO_SOURCEMAP'] !== '1',
    // 3D 場景（Three.js）是動態載入的獨立 chunk，約 150KB gzip；預算見 ADR-0003
    chunkSizeWarningLimit: 700,
  },
});
