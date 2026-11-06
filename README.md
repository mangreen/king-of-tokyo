# King of Tokyo（網頁多人連線 3D 版）

私人專案：把 King of Tokyo 桌遊做成可與朋友連線遊玩的 3D 網頁遊戲。

> 狀態：**M0（骨架與環境）**。規則引擎、卡牌與 3D 場景尚未開始。進度見 [docs/architecture.md](docs/architecture.md)。

## 快速開始

```bash
cp .env.example .env            # 並修改 POSTGRES_PASSWORD
docker compose up --build       # 完整開發環境
```

或不用 Docker（需要 Node 22）：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run dev:server             # http://localhost:3001/healthz
pnpm run dev:web                # http://localhost:5173
```

提交前：`pnpm run check`

## 文件

- [AGENTS.md](AGENTS.md)：給 AI 與開發者的專案規則
- [docs/architecture.md](docs/architecture.md)：架構與里程碑
- [docs/rules-spec.md](docs/rules-spec.md)：規則規格（含待確認事項）
- [docs/adr/](docs/adr/)：架構決策紀錄
- [docs/runbooks/mac-verification.md](docs/runbooks/mac-verification.md)：在 Mac 上驗證 M0

## 智慧財產

遊戲機制參考桌遊《King of Tokyo》（Richard Garfield，IELLO）。專案使用原創的怪獸、卡面與場景設計；官方卡牌文字不隨 repo 提交（見 [ADR-0004](docs/adr/0004-swappable-card-sets.md)）。
