# Mac 驗證清單（M0）

AI 的雲端沙盒沒有 Docker daemon、沒有 GPU，也無法操作你的 Mac，所以以下項目需要你在 **MacBook Pro 2014 / macOS 11.7 Big Sur** 上執行，並把結果貼回來。每一步都寫了預期輸出；不符時請貼完整錯誤。

## 1. 工具版本

```bash
docker --version          # 預期 Docker version 20.10.17
docker compose version    # 預期 Docker Compose version v2.10.2
git --version
node --version            # 可能沒裝；只在「不用 Docker」的路線需要（Node 22）
```

## 2. 取得程式碼

```bash
git clone https://github.com/mangreen/king-of-tokyo.git
cd king-of-tokyo
git checkout m0/skeleton
cp .env.example .env
# 編輯 .env：把 POSTGRES_PASSWORD 改成你自己的值（不要用範例值，也不要提交 .env）
```

## 3. 路線 A：Docker（建議）

```bash
docker compose up --build
```

第一次建置會下載映像與依賴，在這台機器上可能要數分鐘。預期：

- postgres 顯示 `database system is ready to accept connections`
- server 啟動後 `docker compose ps` 顯示 `healthy`
- web 顯示 `Local: http://localhost:5173/`

驗證：

```bash
curl http://localhost:3001/healthz     # 預期 {"status":"ok"}
```

瀏覽器開 http://localhost:5173 ，預期看到「東京之王」標題，下方顯示「已連線（連線 ID：xxxxxxxx）」。

**可能遇到的問題**

- `required variable POSTGRES_PASSWORD is missing`：沒有建立 `.env`，回到第 2 步。
- 改了原始碼但畫面沒更新：Docker Desktop 的 bind mount 事件問題。web 已設定輪詢；server 若沒有重啟，請回報，改走路線 B。
- `docker compose` 報不認得的欄位：代表 Compose 版本比預期舊或新，請貼 `docker compose version` 與錯誤。

停止：`docker compose down`（加 `-v` 會一併刪除資料庫資料）。

## 4. 路線 B：不用 Docker

需要 Node 22 與 pnpm。Big Sur 可能無法執行最新的 Node 安裝檔，請以 `node --version` 確認；若無法安裝，請走路線 A。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check            # 預期全部通過
pnpm run dev:server       # 一個終端機
pnpm run dev:web          # 另一個終端機
```

## 5. 瀏覽器與 WebGL（為 M4 預先確認）

用你打算玩遊戲的瀏覽器開 https://get.webgl.org/webgl2/ ，回報：

- 瀏覽器名稱與版本
- 是否顯示 WebGL2 支援
- 在 `chrome://gpu`（Chrome）或 Safari 的開發選單中，是否為硬體加速

## 6. 依賴安全掃描（Snyk）

你的 Docker Desktop 內建 Snyk。登入後在專案目錄執行：

```bash
snyk test                                  # 依賴漏洞
snyk code test                             # 原始碼 SAST（需要帳號啟用）
docker build --target server -t kot-server . && snyk container test kot-server
```

請把高風險（high/critical）的結果貼回來。Token 只放在環境變數，不要寫進檔案或提交。

## 7. 需要回報的資訊

1. 第 1 步的版本輸出
2. 第 3 步（或第 4 步）是否成功，失敗請貼錯誤
3. 瀏覽器畫面是否顯示「已連線」
4. 第 5 步的 WebGL 結果
5. 第 6 步的高風險漏洞（如果有）
