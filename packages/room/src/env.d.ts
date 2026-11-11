/**
 * 這個套件同時跑在 Node 與瀏覽器 Worker，所以不引入 node 或 DOM 型別（避免不小心用到只有其中一邊有的 API），
 * 只宣告兩邊都有的幾個全域。測試用的設定（tsconfig.test.json）改用 node 型別，不載入這個檔。
 */
declare function setTimeout(callback: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;
declare const console: {
  error(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  log(...data: unknown[]): void;
};
