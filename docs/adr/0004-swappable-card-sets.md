# ADR-0004：可抽換的卡牌組（Card Set）

- 狀態：已採用（2026-11-05）

## 背景

使用者要求卡牌清單**可以抽換**：預設使用所提供的完整卡表，並能隨時切換成由我設計、機制相近的原創卡組。

另有兩個限制：

1. 專案文件只包含約 14 張特殊卡的補充說明與一張卡牌照片，**沒有 66 張卡的完整效果**。官方卡表需要由使用者提供（文字或照片）。
2. 官方卡牌的名稱與規則文字屬於權利人。repo 若為公開，不應提交這些內容。

## 決策

**卡牌組是資料，效果是程式碼，兩者以 `effectId` 連接。**

```
card-sets/
├─ original/        原創卡組（隨 repo 提交）
│  └─ set.json
└─ local/           使用者自備的卡表（.gitignore，不提交）
   └─ set.json
```

- `set.json`：`{ id, name, version, cards: [{ id, name, cost, kind: 'keep'|'discard', text, effectId, params }] }`，以 zod 驗證。
- `effectId` 對應 `@kot/rules` 內註冊的效果實作（hook：`onBuy`、`onRollModify`、`onResolve`、`onDamage`、`onTurnStart`、`onTurnEnd`、`onEliminated` 等）。同一個效果可被不同卡組重用（例如「+2 VP」、「對所有人 3 點傷害」）。
- 效果實作有各自的測試，與卡組內容無關；卡組內容有「卡組驗證」測試（所有 `effectId` 都存在、費用與數量合理、無重複 id）。
- 房間建立時選擇 `cardSetId`，並把**卡組內容的雜湊**記錄進對局日誌，之後重放才不會因為卡表被修改而失真。
- 伺服器啟動時載入 `card-sets/*/set.json`；`local/` 不存在時只提供 `original`。

## 影響

- M3 之前需要使用者提供官方卡表；在那之前，我會先做 `original` 卡組並讓遊戲可完整遊玩。
- 官方卡組放在 `local/`，只存在於使用者自己的機器與部署環境，不進 Git。
- 需要提供的新機制（卡牌效果）必須先寫成通用 hook，避免為單張卡寫特殊分支。
