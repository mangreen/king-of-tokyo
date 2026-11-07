# King of Tokyo（網頁多人連線 3D 版）

私人專案：把 King of Tokyo 桌遊做成可與朋友連線遊玩的網頁遊戲，最終目標是 3D 演出。伺服器權威、回合制，2–6 人。

## 目前可以做什麼

- 在瀏覽器輸入暱稱（不需註冊）→ 建立房間或用 5 碼房號加入 → 準備 → 開始。
- 打完整局**骰子版**規則：擲骰與重擲、能量／治療／攻擊、東京市與東京灣、讓位、淘汰、勝負判定（20 VP 或最後存活，支援多勝者）。
- 斷線可回來接回同一座位；逾時由系統代打。
- **尚未有：** 卡牌（M3）、3D 場景與特效（M4）、事件日誌與負載測試（M5）。目前的畫面是刻意簡陋的功能版。

進度、里程碑與驗證狀態見 [docs/architecture.md](docs/architecture.md)。

## 快速開始

需要 Node 22 與 pnpm（`corepack enable` 會依 `packageManager` 安裝正確版本）。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run dev:server    # 遊戲伺服器 http://localhost:3001（/healthz 可檢查）
pnpm run dev:web       # 網頁 http://localhost:5173
```

開兩個瀏覽器視窗（其一用無痕），各輸入暱稱；一邊建房，另一邊輸入房號加入並按「準備」，房主開始。

或用 Docker（完整開發環境，含 PostgreSQL；資料庫要到 M5 才會用到）：

```bash
cp .env.example .env            # 並修改 POSTGRES_PASSWORD
docker compose up --build
```

## 常用指令

```bash
pnpm run check                                           # 提交前必跑：基準機檢查、格式、lint、型別、測試、建置
pnpm run test                                            # 全部測試
pnpm --filter @kot/rules run play -- --players 4 --seed 7   # 規則引擎文字版（機器人對戰）；加 --games 500 看統計
```

## 結構

```
packages/rules      純規則引擎（無 I/O、可重現、前後端共用）
packages/protocol   WebSocket 訊息型別與 zod 驗證
apps/server         Fastify + Socket.IO：身分、房間、計時，呼叫 rules
apps/web            Vite + React 前端（之後加入 Three.js）
card-sets/          卡牌組資料（M3 起；官方卡表只放 local/，不提交）
```

## 文件

- [AGENTS.md](AGENTS.md)：給 AI 與開發者的專案規則（環境限制、授權、約定）
- [docs/architecture.md](docs/architecture.md)：架構、里程碑與各項驗證狀態
- [docs/rules-spec.md](docs/rules-spec.md)：規則規格（規則編號對應測試）與已決議／待確認事項
- [docs/adr/](docs/adr/)：架構決策（伺服器權威、3D 與美術方向、可抽換卡組、大廳／身分／計時）
- [docs/runbooks/mac-verification.md](docs/runbooks/mac-verification.md)：在基準機（macOS 11 Big Sur）上的驗證清單與紀錄

## 智慧財產

遊戲機制參考桌遊《King of Tokyo》（Richard Garfield，IELLO）。專案使用原創的怪獸、卡面與場景設計；官方卡牌文字不隨 repo 提交（見 [ADR-0004](docs/adr/0004-swappable-card-sets.md)）。
