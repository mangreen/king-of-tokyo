import { defineConfig } from 'tsup';

// workspace 內的 @kot/* 套件以 TS 原始碼發佈，必須一併打包進 server 產物。
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@kot\//],
});
