# ADR-0006：卡牌引擎與協定 v3（M3）

- 狀態：已採用（2026-11-08）

## 背景

M3 要讓遊戲有完整的能力卡：商店與買牌、約 60 種不同的效果、被詢問的決策（讓位、防禦、治療分配…）、復活與搭檔共同勝利，同時維持 ADR-0001／0002 的前提：規則引擎是純函式、可重放、伺服器權威。卡牌內容還要可抽換（[ADR-0004](0004-swappable-card-sets.md)）。

## 決策

### 1. 效果是「參數化的通用元件」，不是一張卡一段程式

- `CardDef = { id, name, cost, kind, text, effectId, params }`，是純資料（JSON-safe）。
- `EFFECTS`（`packages/rules/src/cards/effects.ts`）以 `effectId` 註冊約 60 種通用效果，數值來自 `params`。同一個效果可服務多張卡（例如「額外骰子」、「得 N 點能量」）；Discard 卡的即時效果用 `instant` 加一串 `ops`（得分、治療、傷害…），不需要新程式碼。
- 效果只透過少數 hook 與引擎互動：購買、擲骰期間的修改、結算前後、受傷、回合開始／結束、淘汰。新增卡牌優先組合既有效果；需要新機制時先加通用 hook，不為單張卡寫特殊分支。
- 卡牌組驗證（`@kot/cardsets`）檢查 effectId 存在、卡種與效果相符、必要參數齊全；**對不到的卡讓驗證失敗，不會被默默略過**。

### 2. 引擎介面

`applyAction(state, action, env) → { ok, state, events } | { ok: false, error }`。`env = { cards }` 是外部資料，不放進 state：

- 重放 = 設定 + seed + **卡牌組（id 與內容雜湊）** + 動作日誌。`Room.replayInfo()` 回傳這四項。
- 牌庫洗牌、骰子都用 state 內的 seeded RNG，因此仍是純函式。

### 3. 流程與「待決定事項」

階段：`roll → prompt → buy → over`。需要玩家做決定的情況（讓位、防禦反應、治療分配、重擲他人骰子、立即購買新翻開的牌）統一放進 `state.pending`，phase 為 `prompt`；每一種由固定的動作回應，並以 `pendingSeat` 決定輪到誰。計時、代打、機器人因此都只需處理「目前決策者 + 合法動作」。

- `legalActions(state, env)` 列出目前所有合法動作；網頁用它直接決定要顯示哪些按鈕（按鈕永遠和引擎一致），伺服器仍會再驗證一次。
- 「結構化事件」補上卡牌事件（翻牌、購買、使用、棄置、指示物、復活…），3D 演出照舊是事件的回放。
- 詮釋、與官方規則沒有明說之處，記在 [rules-spec-cards.md](../rules-spec-cards.md)（R-CARD 與 OQ-C1…C9），待使用者確認。

### 4. 隱藏資訊

牌庫順序與 RNG 狀態不能洩漏（知道 RNG 就能預測骰子）。`redactState`／`redactEvent`（`view.ts`）在每位玩家視角：RNG 歸零、牌庫內容抹成空字串（保留張數）、別人窺看到的牌清掉。伺服器 `Room.buildUpdate` 對每位玩家各自遮蔽；測試確認遮蔽後的狀態仍足以算出完整的 `legalActions`。

### 5. 協定 v3

- 握手回傳可用卡牌組清單與預設值；`room:create` 可帶 `cardSetId`，未知的回 `unknown_card_set`。
- `GameActionSchema` 涵蓋引擎全部動作（買牌、掃牌、結束回合、使用卡牌、各種提示的回應）；座位仍由伺服器決定，客戶端送的 `seat` 被丟棄。
- 新增 `game:cards`：開局與重連時送出完整卡牌目錄（卡牌內容是公開資訊，只送一次，不在每次 `game:update` 重複）。
- 新的 ack 錯誤碼：`not_enough_energy`、`card_unavailable`、`cannot_use`、`unknown_card_set`。
- **涵蓋度測試**（`protocol.coverage.test.ts`）：整場隨機模擬中，引擎產生的每一種合法動作都必須通過協定驗證且內容不被丟棄；並以房間為介面打完整局，驗證沒有被拒絕的動作。引擎新增動作而協定沒跟上時，測試會失敗。

### 6. 計時

所有提示（讓位、反應、治療…）共用 `yieldMs`（20 秒）；擲骰與買牌階段用 `decisionMs`（45 秒）。逾時由 `greedyBot(state, env)` 代打：不買牌、不使用能力、不讓位，最保守。

## 取捨與已知限制

- **反應提示只針對骰面攻擊**（OQ-C3）：Discard 卡造成的傷害不詢問防禦，但已啟動的整回合免傷仍有效。
- **別人回合的任意時刻不能插入能力**（OQ-C2）：只在自己回合的擲骰／買牌階段，以及被詢問時可用。這避免了多人即時搶答的複雜度，代價是和實體桌遊略有差異。
- 卡牌效果的數量大，但每個效果都有單元測試，另有「所有效果的整場模擬」（不變量檢查與重放一致）。
- 代打機器人不買牌：被代打的玩家商店資源會閒置。這是刻意保守，之後可改成較聰明的策略。

## 影響

- 卡牌組可在建房時選擇；預設是使用者自備的卡表（`card-sets/local/set.json` 存在時），否則是原創卡組。
- `@kot/server` 依賴 `@kot/cardsets`；正式映像只帶 `card-sets/original`，使用者自備卡組以唯讀 volume 掛載，絕不進映像（`.dockerignore`）。
