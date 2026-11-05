# Mac 驗證清單

AI 的雲端沙盒沒有 Docker daemon、沒有 GPU，也無法操作你的 Mac，所以以下項目需要你在 **MacBook Pro 2014 / macOS 11.7 Big Sur** 上執行，並把結果貼回來。每一步都寫了預期輸出；不符時請貼完整錯誤（**請先檢查輸出裡有沒有登入網址或 token，有的話先刪掉**）。

## 驗證紀錄

### M0（2026-11-05，使用者實測）

| 項目                                                 | 結果                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Docker 20.10.17 / Compose v2.10.2 / git 2.32.0       | ✅                                                                      |
| Node v22.23.2（nvm）                                 | ✅ 可執行                                                               |
| `docker compose up --build`                          | ✅ postgres、server、web 啟動；`curl localhost:3001/healthz` 回 `ok`    |
| WebGL2（get.webgl.org/webgl2）                       | ✅ 支援                                                                 |
| `docker build --target server`                       | ✅ 建置成功                                                             |
| `pnpm install`（本機）                               | ❌ esbuild 0.28.2 的 postinstall 失敗：`_SecTrustCopyCertificateChain`  |
| `snyk test` / `snyk auth` / `snyk code test`（本機） | ❌ Snyk CLI 的 macOS 二進位檔需要 macOS 13；`snyk code` 需先在帳號啟用  |
| `snyk container test kot-server`                     | ⚠️ 可執行。應用程式依賴與 Alpine 乾淨；高風險項目都在映像內的 pnpm／npm |

### 發現的問題與修正（尚待你重新驗證）

1. **esbuild 在 Big Sur 無法安裝。** esbuild 0.27 起的 macOS 二進位檔最低需要 macOS 12。已改為 tsx 4.20.6、tsup 8.5.0（它們相容 esbuild 0.25.12，最低 macOS 11），並加上 `pnpm run check:baseline` 防止日後回退。lockfile 裡其他三個 macOS 原生套件（rolldown、rollup、lightningcss）最低只要 macOS 10.12–10.13。
2. **Snyk 容器掃描的高風險項目不是我們的程式碼。** 掃描結果中 33 個與 24 個問題的專案名稱是 `dist`（corepack 下載的 pnpm）與 `lib`（base image 的 npm）。我們自己的依賴（專案 `king-of-tokyo`）與 Alpine 系統套件都是乾淨的。已改成乾淨的 runtime 映像，不帶 pnpm、npm、yarn、corepack。

## 1. 更新並重新安裝

```bash
cd king-of-tokyo
git fetch origin
git checkout m0/skeleton && git pull
rm -rf node_modules apps/*/node_modules packages/*/node_modules
corepack enable          # 第一次會問是否下載 pnpm 10.28.0，回答 y
pnpm install --frozen-lockfile
```

預期：安裝成功，沒有 `postinstall failed`。可能會看到 `unmet peer esbuild` 的警告，這是 vite 的**選用** peer，不影響執行。

```bash
pnpm run check           # 預期全部通過，最前面印出「基準機相容性檢查通過」
```

## 2. Docker 開發環境

```bash
cp .env.example .env     # 已有 .env 就略過
docker compose up --build
curl http://localhost:3001/healthz     # 預期 {"status":"ok"}
```

瀏覽器開 http://localhost:5173 ，預期顯示「已連線（連線 ID：xxxxxxxx）」。

停止：`docker compose down`（加 `-v` 會一併刪除資料庫資料）。

## 3. 正式 server 映像（這次改了，沒有實機驗證）

```bash
docker build --target server -t kot-server .
docker run --rm -p 3001:3001 kot-server &
sleep 2
curl http://localhost:3001/healthz     # 預期 {"status":"ok"}
docker stop $(docker ps -q --filter ancestor=kot-server)
docker run --rm kot-server sh -c 'which npm pnpm yarn corepack || echo "沒有套件管理器（預期）"'
```

## 4. 依賴安全掃描

Snyk CLI 在 Big Sur 上只能降級執行。建議順序：

```bash
# a) 容器（可執行）。預期不再出現專案 dist / lib
snyk container test kot-server

# b) 依賴：需要 --all-projects（monorepo）。若 CLI 因 macOS 版本無法執行，改用 c) 或 d)
snyk test --all-projects

# c) 任何環境都能執行
pnpm audit --prod

# d) 在 Snyk 網站匯入 GitHub repo mangreen/king-of-tokyo（不需要本機 CLI）
#    Snyk Code（SAST）需先到 Settings > Snyk Code 啟用
```

沙盒中的 `pnpm audit --prod` 結果：**沒有已知漏洞**（2026-11-06）；含 dev 依賴有 1 個中等風險（`eslint` 內的 `minimatch`，不會進入任何映像）。

請把高風險（high/critical）的結果貼回來。Token 只放在環境變數，不要寫進檔案或提交。

## 5. 瀏覽器與 WebGL（為 M4 預先確認）

已確認支援 WebGL2。M4 前還需要的資訊（用你打算玩遊戲的瀏覽器）：

- 瀏覽器名稱與版本
- 在 `chrome://gpu`（Chrome）或 Safari 的開發選單中，是否為硬體加速
- `about:support`（Firefox）或 `chrome://gpu` 中顯示的 GPU 與 WebGL2 的最大紋理尺寸

## 6. 需要回報的資訊

1. 第 1 步 `pnpm install` 與 `pnpm run check` 是否成功，失敗請貼錯誤
2. 第 2、3 步的結果
3. 第 4 步 `snyk container test kot-server` 的專案清單與高風險數量
4. 第 4 步 b) 的結果，或你選了 c)／d)
