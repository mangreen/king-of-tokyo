# ADR-0004：可抽換的卡牌組（Card Set）

- 狀態：已採用（2026-11-05），**2026-11-06 補充卡表現況與公開 repo 的處理**

## 背景

使用者要求卡牌清單**可以抽換**：預設使用所提供的完整卡表，並能隨時切換成由我設計、機制相近的原創卡組。

現況（2026-11-06）：

1. 使用者已提供完整卡表 `KingOfTokyo_CardList - EN.csv`，放在**專案 context**（Claude Project）中，欄位為 `Name, Cost, Type, Ability`。內容：
   - 75 列；`Evacuation Orders (x2)`、`Extra Head (x2)` 各代表 2 張，展開後共 **77 張**（Keep 56 列、Discard 19 列）。
   - 費用 2–8。
   - 檔案中間有一個空行，分成兩個區塊（前 65 列、後 10 列）。我無法判斷後一區塊是哪個版本或擴充，M3 時再向使用者確認是否全部納入。
   - 文字使用 `[Star]`（勝利點）、`[Heart]`、`[Energy]`、`[Attack]`、`[1][2][3]` 等記號。
2. 官方卡牌的名稱與規則文字屬於權利人。**repo 目前是公開的（之後會轉私人）**。

## 決策

**卡牌組是資料，效果是程式碼，兩者以 `effectId` 連接。**

```
card-sets/
├─ original/        原創卡組（隨 repo 提交）
│  └─ set.json
└─ local/           使用者自備的卡表（.gitignore，不提交）
   ├─ KingOfTokyo_CardList - EN.csv   原始 CSV
   └─ set.json                        由匯入腳本產生
```

- `set.json`：`{ id, name, version, cards: [{ id, name, cost, kind: 'keep'|'discard', text, effectId, params }] }`，以 zod 驗證。
- `effectId` 對應 `@kot/rules` 內註冊的效果實作（hook：`onBuy`、`onRollModify`、`onResolve`、`onDamage`、`onTurnStart`、`onTurnEnd`、`onEliminated` 等）。同一個效果可被不同卡組重用（例如「+2 VP」、「對所有人 3 點傷害」）。
- 效果實作有各自的測試，與卡組內容無關；卡組內容有「卡組驗證」測試（所有 `effectId` 都存在、費用與數量合理、無重複 id）。
- 房間建立時選擇 `cardSetId`，並把**卡組內容的雜湊**記錄進對局日誌，之後重放才不會因為卡表被修改而失真。
- 伺服器啟動時載入 `card-sets/*/set.json`；`local/` 不存在時只提供 `original`。

### CSV 匯入（M3）

匯入腳本讀取 `card-sets/local/*.csv`，產生 `local/set.json`，並處理 CSV 的已知瑕疵：

- 14 列的 Ability 有多餘的雙引號（例如 `"+ 3[Star]"`，值本身帶著引號）。
- `Healing Ray` 的括號不成對；`Fire Breathing` 結尾沒有句點。
- `(xN)` 後綴表示張數，匯入時展開並去掉後綴。
- 每張卡必須對應到一個 `effectId`；**對不到的卡會讓驗證失敗**，而不是被默默略過。

### 公開 repo 的規則

- **卡表 CSV、官方卡面文字、遊戲截圖都不提交到 Git。** 這已寫入 `.gitignore`（`card-sets/local/`）。
- 轉私人之後，公開期間已提交的內容仍可能被他人複製過，所以「公開期間不提交」是永久規則。轉私人後要不要把卡表提交進 repo，屆時再決定。
- 需要卡表的測試在 `local/` 不存在時**自動跳過**（例如 CI 上），而不是失敗；CI 以 `original` 卡組驗證效果引擎。
- 要在其他機器或部署環境使用官方卡表，需要自行把 CSV 放進 `card-sets/local/`。

## 影響

- 在 M3 之前，我會先做 `original` 卡組並讓遊戲可完整遊玩；官方卡表的效果對應工作排在 M3。
- 77 張卡裡有幾張需要特別的規則引擎支援，**必須在 M1 設計狀態模型時就考慮**，否則 M3 會很痛苦：
  - **Monster Sidekick**：共同勝利（見 rules-spec 的 OQ-4）。
  - **Frenzy、Freeze Time**：額外回合（見 R-END-09）。
  - **It Has a Child**：被淘汰後復活。
  - **Mimic、Parasitic Tentacles、Opportunist、Psychic Probe、Healing Ray**：會改變買牌或擲骰的資格，需要「插斷式決策」。
- 需要新機制的卡牌效果必須先寫成通用 hook，避免為單張卡寫特殊分支。
