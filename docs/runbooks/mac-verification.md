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

### M0 修正後重新驗證（2026-11-06，使用者實測）

| 項目                                           | 結果                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`（Big Sur）    | ✅ esbuild 0.25.12 的 postinstall 成功                                      |
| `pnpm run check`                               | ✅ 基準機檢查、格式、lint、typecheck、35 個測試、建置全部通過               |
| `docker build --target server` 與 `docker run` | ✅ `/healthz` 回 ok；收到 SIGTERM 後優雅關閉                                |
| 映像內是否還有 npm／pnpm／yarn／corepack       | ✅ 沒有                                                                     |
| `snyk container test kot-server`               | ✅ 只剩 Alpine 系統套件專案，19 個套件無漏洞；先前的 `dist`、`lib` 專案消失 |
| `snyk test --all-projects`                     | ✅ 5 個專案無漏洞（server 70 個依賴、web 14 個、protocol 1 個）             |
| `pnpm audit --prod`                            | ✅ 無已知漏洞                                                               |

說明：

- 修正後的 runtime 映像裡沒有 lockfile，所以容器掃描不再列出應用程式的 npm 依賴；這部分由 `snyk test --all-projects` 與 `pnpm audit` 負責。
- Snyk CLI 在 Big Sur 仍會印出 `dyld: Symbol not found` 與 degraded 警告，但掃描本身可以完成，這些訊息可以忽略。

### 發現的問題與修正（已修正，已重新驗證）

1. **esbuild 在 Big Sur 無法安裝。** esbuild 0.27 起的 macOS 二進位檔最低需要 macOS 12。已改為 tsx 4.20.6、tsup 8.5.0（它們相容 esbuild 0.25.12，最低 macOS 11），並加上 `pnpm run check:baseline` 防止日後回退。lockfile 裡其他三個 macOS 原生套件（rolldown、rollup、lightningcss）最低只要 macOS 10.12–10.13。
2. **Snyk 容器掃描的高風險項目不是我們的程式碼。** 掃描結果中 33 個與 24 個問題的專案名稱是 `dist`（corepack 下載的 pnpm）與 `lib`（base image 的 npm）。我們自己的依賴（專案 `king-of-tokyo`）與 Alpine 系統套件都是乾淨的。已改成乾淨的 runtime 映像，不帶 pnpm、npm、yarn、corepack。

## M2 實測清單（分支 `m2/lobby-and-connection`）

沙盒已用 Playwright 開兩個瀏覽器跑過：建房 → 加入 → 準備 → 開始 → 打完一局 → 重新整理頁面接回。以下需要在你的 Mac 與真實瀏覽器上確認。

```bash
git fetch origin && git checkout m2/lobby-and-connection && git pull
pnpm install --frozen-lockfile
pnpm run check
docker compose up --build        # 或：pnpm run dev:server 與 pnpm run dev:web 各開一個終端機
```

1. 開兩個瀏覽器視窗（其中一個用無痕視窗，因為身分存在 sessionStorage，同一分頁的不同視窗不會共用，但無痕更保險）到 http://localhost:5173。
2. 視窗 A 輸入暱稱 → 建立房間，記下 5 碼房號；視窗 B 輸入另一個暱稱 → 用房號加入 → 按「準備」。
3. A 按「開始遊戲」。預期：兩邊都看到玩家表、東京市、倒數計時；輪到的人可以「擲骰／重擲／結算」，點骰子可保留。
4. **重連：** 對局中在 B 按重新整理。預期：回到同一座位的對局畫面（事件日誌會是空的，這是預期行為）。
5. **逾時代打：** 輪到某位玩家時什麼都不做，等 45 秒。預期：標示「代打中」，系統代打；之後那位玩家再按任何合法動作就會取回控制。
6. **斷線：** 對局中關掉 B 的分頁。預期：A 看到 B「離線」，輪到 B 時約 1.5 秒就被代打。
7. 手機同一個 Wi-Fi：把 `.env` 的 `ALLOWED_ORIGINS` 加上 `http://<你的 Mac 區網 IP>:5173`，並把 `VITE_SERVER_URL` 改成 `http://<IP>:3001`，用手機瀏覽器開（選配）。

請回報：`pnpm run check` 是否通過、第 3–6 步是否符合預期（失敗請貼瀏覽器 Console 的錯誤，**不要貼含 sessionToken 的內容**）。

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
