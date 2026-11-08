# card-sets

卡牌組資料。設計與理由見 [ADR-0004](../docs/adr/0004-swappable-card-sets.md)。

| 目錄        | 內容                     | 是否提交               |
| ----------- | ------------------------ | ---------------------- |
| `original/` | 原創卡組（隨 repo 提交） | 是                     |
| `local/`    | 使用者自備的官方卡表     | **否**（`.gitignore`） |

`pnpm --filter @kot/cardsets run import` 會把 `local/` 內的官方卡表 CSV 轉成 `local/set.json`。
