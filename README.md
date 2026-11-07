# King of Tokyo（網頁多人連線 3D 版）

私人專案：把 King of Tokyo 桌遊做成可與朋友連線遊玩的網頁遊戲，最終目標是 3D 演出。伺服器權威、回合制，2–6 人。

## 目前可以做什麼

- 在瀏覽器輸入暱稱（不需註冊）→ 建立房間或用 5 碼房號加入 → 準備 → 開始。
- 打完整局規則：擲骰與重擲、能量／治療／攻擊、東京市與東京灣、讓位、淘汰、勝負判定（20 VP 或最後存活，支援多勝者）。
- **能力卡：** 商店三張牌、買牌、花 2 能量清掉商店、持續（Keep）與一次性（Discard）卡、使用卡牌能力、被攻擊時的防禦反應、治療分配、復活與搭檔共同勝利。建房時可選卡牌組（原創卡組；若放了自備卡表則多一個選項）。
- 斷線可回來接回同一座位；逾時由系統代打（代打不買牌、不使用能力）。
- **尚未有：** 3D 場景與特效（M4）、事件日誌與負載測試（M5）。目前的畫面是刻意簡陋的功能版。

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
pnpm --filter @kot/cardsets run import                   # 把 card-sets/local/ 內的官方卡表 CSV 轉成 set.json
```

### 使用自備卡表

把卡表 CSV 放進 `card-sets/local/`（該目錄不會被提交，也不會進 Docker 映像），執行上面的 `import` 指令產生 `set.json`，重啟伺服器後，建房時就會多一個卡牌組選項，且成為預設值。沒有放時只提供原創卡組。Docker 開發環境會自動把 `card-sets/` 以唯讀方式掛進 server 容器。

## 結構

```
packages/rules      純規則引擎（無 I/O、可重現、前後端共用）
packages/protocol   WebSocket 訊息型別與 zod 驗證
packages/cardsets   卡牌組驗證、載入、雜湊與 CSV 匯入（伺服器與匯入腳本使用）
apps/server         Fastify + Socket.IO：身分、房間、計時，呼叫 rules
apps/web            Vite + React 前端（之後加入 Three.js）
card-sets/          卡牌組資料（original 提交；官方卡表只放 local/，不提交）
```

## 文件

- [AGENTS.md](AGENTS.md)：給 AI 與開發者的專案規則（環境限制、授權、約定）
- [docs/architecture.md](docs/architecture.md)：架構、里程碑與各項驗證狀態
- [docs/rules-spec.md](docs/rules-spec.md)、[docs/rules-spec-cards.md](docs/rules-spec-cards.md)：規則規格（規則編號對應測試；後者是卡牌規則與待確認的詮釋）
- [docs/adr/](docs/adr/)：架構決策（伺服器權威、3D 與美術方向、可抽換卡組、大廳／身分／計時、卡牌引擎與協定 v3）
- [docs/runbooks/mac-verification.md](docs/runbooks/mac-verification.md)：在基準機（macOS 11 Big Sur）上的驗證清單與紀錄

## 智慧財產

遊戲機制參考桌遊《King of Tokyo》（Richard Garfield，IELLO）。專案使用原創的怪獸、卡面與場景設計；官方卡牌文字不隨 repo 提交（見 [ADR-0004](docs/adr/0004-swappable-card-sets.md)）。
