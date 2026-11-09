# AGENTS.md

給 AI Agent 與開發者的專案穩定規則。通用工程規範遵循《AI Development Guidelines v4.2》，本文件只記錄本專案的具體事項。若兩者衝突，以明確的使用者指示與本文件為準。

## 專案

King of Tokyo 桌遊的網頁多人連線 3D 版，私人與朋友遊玩。伺服器權威、回合制、目標容量 10,000 人在線。

- 規則：[docs/rules-spec.md](docs/rules-spec.md) 與 [docs/rules-spec-cards.md](docs/rules-spec-cards.md)（唯一規則來源，規則編號對應測試）
- 架構：[docs/architecture.md](docs/architecture.md)
- 決策：[docs/adr/](docs/adr/)
- 目前進度與待確認事項：見 `docs/architecture.md` 的里程碑表與 `docs/rules-spec.md` 的 Open Questions

## 結構

```
packages/rules      純規則引擎（無 I/O、可重現、前後端共用）
packages/protocol   WebSocket 訊息型別與 zod 驗證、協定版本
packages/cardsets   卡牌組 schema 驗證、載入、內容雜湊、官方 CSV 匯入
apps/server         Fastify + Socket.IO，房間與計時，呼叫 rules
apps/web            Vite + React；src/scene/ 為 Three.js 場景（動態載入，事件回放，見 ADR-0003）
card-sets/          卡牌組資料（original 提交；local 不提交，見 ADR-0004）
```

`@kot/*` 套件直接以 TypeScript 原始碼匯出（不先編譯）。server 由 tsup 把它們打包進產物；web 由 Vite 處理。

## 指令

```bash
pnpm install --frozen-lockfile
pnpm run check        # check:baseline + format:check + lint + typecheck + test + build（提交前必跑）
pnpm run check:baseline  # lockfile 沒有基準機（Big Sur）跑不動的原生工具
pnpm run test         # 全部測試
pnpm --filter @kot/rules run play -- --players 4 --seed 7   # 規則引擎文字版（機器人對戰，加 --games 500 看統計）
pnpm run dev:server   # 本機直接跑 server（不用 Docker）
pnpm run dev:web      # 本機直接跑 web
docker compose up --build   # 完整開發環境（需 cp .env.example .env）
```

## 環境約束（重要）

- **基準機：** 2014 MacBook Pro 13"（雙核 i7、Intel Iris、16GB、macOS 11.7 Big Sur）。建置與測試要輕量；3D 效能預算以它為準（見 ADR-0003）。
- **Docker Desktop 4.12 / Engine 20.10 / Compose v2.10：** `docker-compose.yml` 與 `Dockerfile` 只使用舊版就支援的語法。**不要**使用 `develop.watch`、`include`、`RUN --mount`、heredoc、`# syntax=` 指令。
- **不啟用 Kubernetes。** 專案不需要，也吃資源。
- **esbuild 必須低於 0.27（目前 0.25.12）。** esbuild 0.27 起的 macOS 二進位檔需要 macOS 12，基準機（Big Sur 11）的 `pnpm install` 會因 `SecTrustCopyCertificateChain` 缺符號而失敗（2026-11-05 實測）。因此 **tsx 固定 4.20.6、tsup 固定 8.5.0**（兩者宣告相容 esbuild 0.25），**不要**用 `pnpm update --latest`。`pnpm run check:baseline` 會在 lockfile 出現不相容的 esbuild 時失敗。
- **Node 22 在 Big Sur 上已實測可執行**（v22.23.2，nvm 安裝）。升級 Node 前需在基準機確認。
- **Snyk CLI 在 Big Sur 無法完整執行**（其 macOS 二進位檔需要 macOS 13）：`snyk container test` 可用（降級模式），`snyk test` 需加 `--all-projects`。Snyk Code 需要先在 Snyk 設定中啟用。依賴掃描的替代方式：`pnpm audit --prod`（任何環境都可執行），或在 Snyk 網站匯入 GitHub repo。
- **TypeScript 固定在 ~6.0。** typescript-eslint 目前宣告只支援 `<6.1.0`；升到 TS 7 前先確認 lint 工具支援。
- **沙盒限制：** AI 的雲端環境沒有 Docker daemon、沒有 GPU，也無法操作使用者的 Mac。Compose 實際啟動、3D 效能、Big Sur 瀏覽器相容性都必須由使用者實測，回報時一律標示「未實測」。

## 開發約定

- 規則變更先改 `docs/rules-spec.md`（卡牌規則改 `rules-spec-cards.md`），再改程式與測試；測試名稱或描述包含規則編號（如 `R-TOKYO-03`）。
- 規則引擎必須是純函式：不得使用 `Math.random`、`Date.now`、I/O。亂數一律經 `@kot/rules` 的 RNG，狀態可序列化。
- 規則引擎輸出**結構化事件**（供 3D 演出回放，見 ADR-0003），不只輸出最終狀態。
- 所有來自網路的資料都用 zod 驗證；對外錯誤只回穩定的 `code` 與簡短訊息，不含 stack trace、路徑或憑證。
- 不提交機密。`.env` 被忽略，只提交 `.env.example`。不在回覆、Log、記憶中重述機密值。
- 卡牌是資料、效果是參數化的通用程式（ADR-0004、ADR-0006）：新卡優先組合既有 `effectId`；需要新機制就加通用 hook，不為單張卡寫分支。引擎新增動作時，協定（`GameActionSchema`）要跟上，`protocol.coverage.test.ts` 會把關。
- 素材使用原創設計；不放入 IELLO（King of Tokyo）或東寶（哥吉拉）的角色、卡圖。官方卡表只放 `card-sets/local/`（不提交、不進 Docker 映像）。`effect-map.json` 以卡名雜湊為 key，官方卡名不要寫進程式碼、文件或測試（`rules-spec*.md` 既有的少數引用除外，新增請用通用說法）。
- **repo 目前是公開的（之後會轉私人）。** 卡表 CSV、遊戲截圖、第三方素材一律不提交。轉私人之後規則不變：公開期間的 commit 歷史可能已被他人複製。

## Git 與授權

- 工作流程：GitHub Flow。每個里程碑一個分支（`m0/skeleton`、`m1/rules-engine`…），透過 PR 合併至 `main`。
- **使用者已授權（2026-11-05）：** 推送各里程碑分支到 `origin`。
- **使用者已授權（2026-11-06）：** 建立 `main`。遠端原本沒有 `main`（使用者找不到），因此以初始 commit（只含 README）建立，作為 PR 的基準分支。**之後對 `main` 的推送與合併仍須先詢問。**
- **未授權，須先詢問：** 推送或修改 `main`、合併 PR、建立 release/tag、部署、刪除分支或資料、變更權限與機密設定。
- Commit 訊息使用 Conventional Commits，結尾附上 session 註記（Co-Authored-By 與 Claude-Session）。
- 提交前確認 `git diff` 沒有無關修改、機密或建置產物。

## 工作階段收尾

每次工作階段結束前（或交付一個里程碑時）更新 `README.md`：目前狀態與可用功能、快速開始與指令、結構、文件連結。**移除過期資訊**（舊的里程碑狀態、已不存在的檔案或指令），並確認 README 裡的指令實際可執行。README 只放「現在是什麼」，歷史與細節留在 `docs/`。

## 回報規則

交付時區分狀態：**Implemented**（已寫）、**Tested**（已實際跑過測試並說明結果）、**Reviewed**、**Merged**、**Deployed**、**Verified in Production**。只有實際執行且取得結果的檢查才能寫成通過；無法執行的要標示原因（例如沙盒沒有 Docker）。
