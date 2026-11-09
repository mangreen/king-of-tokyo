# King of Tokyo（網頁多人連線 3D 版）

私人專案：把 King of Tokyo 桌遊做成可與朋友連線遊玩的網頁遊戲，最終目標是 3D 演出。伺服器權威、回合制，2–6 人。

## 目前可以做什麼

- 在瀏覽器輸入暱稱（不需註冊）→ 建立房間或用 5 碼房號加入 → 準備 → 開始。
- 打完整局規則：擲骰與重擲、能量／治療／攻擊、東京市與東京灣、讓位、淘汰、勝負判定（20 VP 或最後存活，支援多勝者）。
- **能力卡：** 商店三張牌、買牌、花 2 能量清掉商店、持續（Keep）與一次性（Discard）卡、使用卡牌能力、被攻擊時的防禦反應、治療分配、復活與搭檔共同勝利。建房時可選卡牌組（原創卡組；若放了自備卡表則多一個選項）。
- 斷線可回來接回同一座位；逾時由系統代打（代打不買牌、不使用能力）。
- **3D 戰場（M4）：** 真實東京灣配置的場景——東京鐵塔、晴空塔、彩虹大橋、台場（摩天輪）、隅田川、東京灣；原創的程序化怪獸（6 種造型）、踩踏／打擊感／淘汰／護盾特效、事件鏡頭、3D 骰子。所有演出都是伺服器事件的回放，可跳過；畫質可自動降級，也可關閉 3D（沒有 WebGL 時自動退回純 DOM 介面）。
- **3D 區內完整操作（M4.5）：** 玩家、擲骰與動作、商店、事件、規則、我的卡牌都在 3D 區內，而且**不遮住地圖**——寬螢幕／橫向是「地圖在左、面板在右」，直向（手機／平板）是「地圖固定在上方、面板在下方捲動」；也可全螢幕。玩家持有的卡牌可用滑鼠移上去、點一下或長按（觸控）、鍵盤聚焦查看完整說明；擲骰區可展開「結算規則」並即時預覽這組骰子的收益；「🏁 勝利條件」可在狀態列、事件與規則面板查看。沒有 3D 時同一份 HUD 排在頁面裡。
- **地圖可拖曳縮放（M4.6）：** 滑鼠拖曳移動、滾輪縮放（以游標為中心）；觸控單指拖曳、雙指縮放；也有 ＋／－ 按鈕、方向鍵與 +/-/0，雙擊或 ↺ 重置。調整視角時暫停自動鏡頭，重置後恢復。
- **鏡頭跟隨（M4.7）：** 輪到哪隻怪獸行動，鏡頭就平滑地移過去並拉近（方位不變、地圖不旋轉）；攻擊、踩踏等演出仍會切到演出鏡頭，演出結束回到跟隨。可用地圖右下的 🎥（綠色＝跟隨中、灰色＝關、綠色虛線框＝你調整了視角而暫停，點一下重置視角並回到跟隨）或下方「鏡頭跟隨行動中的怪獸」開關；「減少動態」或手動調整視角時不跟隨。
- **提示（M4.8）：** 買牌階段輪到你且買得起牌時跳出「商店有 N 張牌買得起」（可直接前往商店）；重大事件（輪到你、淘汰、重擊、自己血量見底、進入東京、有人接近或達到勝利分數、買牌、中毒…）會跳出提示，其餘留在事件日誌。商店還有買得起的牌時，「結束回合」會先換成橘色的「🚪 離開商店」，按過才出現「結束回合」，避免不小心直接結束。
- **座位避開大型建物＋招式特效（M4.9）：** 怪獸環形站位會避開東京鐵塔擋住視線的那一段弧，並用「障礙盒」檢查（鐵塔、晴空塔、彩虹大橋橋面與塔、摩天輪、電視台大樓）確認從總覽鏡頭與跟隨鏡頭看，每個座位都不會被擋到。每種怪獸造型有各自的攻擊招式——蜥蜴能量吐息、猿搥地、機械雷射、章魚墨汁鞭、螃蟹爪擊、龍噴火（原創、純視覺，傷害仍由伺服器決定）；可在場景下方取消勾選「怪獸招式特效」關閉（系統「減少動態」時預設關閉）。
- **尚未有：** 事件日誌持久化與負載測試（M5）。3D 效能目前只在沙盒（軟體算圖）量過，基準機實測見 [runbook](docs/runbooks/mac-verification.md)。

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

不連伺服器看 3D 場景：開 `http://localhost:5173/?scene-demo`（離線展示頁，可手動觸發各種演出、切換畫質）。

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

先建立資料夾並放入卡表 CSV：`mkdir -p card-sets/local && cp <卡表>.csv card-sets/local/`（該目錄不會被提交，也不會進 Docker 映像），再執行上面的 `import` 指令產生 `set.json`，重啟伺服器後，建房時就會多一個卡牌組選項，且成為預設值。沒有放時只提供原創卡組。Docker 開發環境會自動把 `card-sets/` 以唯讀方式掛進 server 容器。

## 結構

```
packages/rules      純規則引擎（無 I/O、可重現、前後端共用）
packages/protocol   WebSocket 訊息型別與 zod 驗證
packages/cardsets   卡牌組驗證、載入、雜湊與 CSV 匯入（伺服器與匯入腳本使用）
apps/server         Fastify + Socket.IO：身分、房間、計時，呼叫 rules
apps/web            Vite + React 前端；src/scene/ 是 Three.js 場景（動態載入）、src/hud/ 是遊戲 HUD 與說明提示
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
