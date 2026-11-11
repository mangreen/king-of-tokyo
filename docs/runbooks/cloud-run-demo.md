# 試玩版：單一容器部署到 Google Cloud Run

> **狀態：未實測。** 沙盒沒有 Docker 也沒有 GCP 帳號，所以 image 建置與 Cloud Run 部署都沒有實際跑過。
> 沙盒驗證過的是：用與 image 相同的設定（`WEB_DIR`、`PORT`、同來源、上限）直接以 node 跑打包後的伺服器＋網頁，
> 完成雙人對局，且瀏覽器 console 沒有錯誤／CSP 違規。請依下面步驟在你的 Mac 上實測，並回報結果。

## 它是什麼

- **一個容器**：Fastify 伺服器直接提供建置好的網頁，同一個網址與埠也提供 Socket.IO。沒有 nginx、沒有資料庫。
- **全部在記憶體**：房間、玩家、對局都在伺服器記憶體裡。容器重啟或縮到 0 台，所有房間就消失（試玩版可以接受）。
  （M5 的 Postgres 持久化不在試玩版內。Cloud Run 的檔案系統是暫存的，所以也不用 SQLite。）
- **只有原創卡組**：`.dockerignore` 排除卡表 CSV 與 `card-sets/local`，映像裡不會有任何官方卡牌資料。
- **限制**（寫死在 Dockerfile 的 `ENV`，可用 `--set-env-vars` 覆寫）：
  - `MAX_ROOMS=5`：同時最多 5 個房間，滿了建房會回「伺服器房間數已達上限」。
  - `MAX_CONNECTIONS=30`：同時最多 30 個連線（含在大廳的人），超過的新連線會看到「試玩名額已滿」。
  - `IDLE_KICK_MS=300000`：連線 5 分鐘沒有任何操作（滑鼠、鍵盤、觸控、遊戲動作）就被中斷，顯示「重新連線」按鈕，身分與座位保留。**這是為了不讓「開著網頁就離開」的分頁一直佔著執行個體**：Cloud Run 只要有 WebSocket 連著，該執行個體就持續計費，而客戶端斷線會自動重連，單靠 60 分鐘的請求逾時擋不住。
- **只在明確要求時才建**：`make demo-image`。`make build`、`make test`、docker compose、CI 都不會建這個 image。

## 1. 本機建置與試跑

```bash
make demo-image          # docker build --target demo -t kot-demo .
make demo-run            # http://localhost:8080
```

在 Apple Silicon 上建置要加 `--platform linux/amd64`（Cloud Run 要 amd64）；Intel Mac 不用。
用兩個瀏覽器分頁（或一個一般視窗＋一個無痕視窗）登入不同暱稱，建房、加入、開始，確認可以完整玩一局。

`make demo-run` 用 Ctrl+C 就會乾淨結束並自動移除容器（`--rm`）。如果容器卡住（舊版伺服器有這個問題，已修正），先 `docker stop kot-demo`（等不到就 `docker kill kot-demo`），再 `docker rmi kot-demo`；image 只要還有容器在用（即使已停止）就刪不掉。

建完請看一下 image 大小並回報：`docker image ls kot-demo`（我預估壓縮後約 60–80 MB，這是估計，沒有量過）。

## 2. 第一次部署（區域：台灣 `asia-east1`）

```bash
PROJECT_ID=<你的專案 ID>
REGION=asia-east1
REPO=kot
SERVICE=kot-demo

gcloud auth login
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com

# Artifact Registry（存 image；每月 0.5 GB 免費）
gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION"
gcloud auth configure-docker "$REGION-docker.pkg.dev"

IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/kot-demo:$(git rev-parse --short HEAD)"
docker tag kot-demo "$IMAGE"
docker push "$IMAGE"

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 --memory 512Mi \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 80 \
  --timeout 3600
```

各參數的原因：

| 參數                         | 原因                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `--max-instances 1`          | 房間在記憶體裡，多台 instance 彼此看不到對方的房間。**一定要是 1。**                                                                    |
| `--min-instances 0`          | 沒人玩時縮到 0 台，不計費（代價：第一個人要等冷啟動，約幾秒）。                                                                         |
| `--cpu 1`                    | 免費額度以 vCPU 秒計。小於 1 vCPU 時 Cloud Run 會限制 concurrency 為 1，WebSocket 多人不能用。                                          |
| `--memory 512Mi`             | 5 個房間 30 個連線遠用不到；若 OOM 再調高。                                                                                             |
| `--timeout 3600`             | 單一請求（含 WebSocket 連線）最長 60 分鐘，這已是上限。超過會被中斷，客戶端會自動用 sessionToken 重連並接回座位（**這條路徑未實測**）。 |
| 不要加 `--no-cpu-throttling` | 預設「只在處理請求時計費」，有人連著（WebSocket 算處理中）才計費；加了會一直計費。                                                      |

部署完成後會印出服務網址（`https://kot-demo-xxxxx-de.a.run.app`），直接分享給朋友即可。

更新版本：重新 `make demo-image` → tag（用新的 commit 簡短 SHA）→ push → 再執行一次 `gcloud run deploy`（參數同上）。

## 3. 免費額度大約能玩多久

Cloud Run（依請求計費）每月免費：**180,000 vCPU 秒、360,000 GiB 秒、200 萬請求**
（依 [Cloud Run 定價頁](https://cloud.google.com/run/pricing)；免費額度以 us-central1 費率折抵，換算與區域有關，請在定價頁確認 `asia-east1` 的實際折抵）。

以 1 vCPU／512 MiB 估算，瓶頸是 CPU：180,000 秒 ≈ **50 小時「至少有一個連線」的時間**。
同一台 instance 上所有玩家共用這段時間（6 個人同玩 1 小時只算 1 小時），沒人連線時不計費。
請求數幾乎用不到（一個 WebSocket 連線算 1 個請求）。

用完免費額度會開始計費，所以務必設預算警示（下一節）。

## 4. 設定預算警示（Budget alert）

預算警示**只會寄信通知，不會自動停止服務或停止計費**。它是「發現超支」的保險，請務必設。

### 用 Console 設定（最直覺）

1. 打開 <https://console.cloud.google.com/billing>，選你的結算帳戶（Billing account）。
2. 左側選 **Budgets & alerts（預算與快訊）** → **CREATE BUDGET（建立預算）**。
3. **Name**：`kot-demo`。**Time range**：Monthly。
4. **Scope（範圍）**：
   - Projects：只選這個試玩專案。
   - Services：可選 **Cloud Run**（與 Artifact Registry），也可以不限制服務（建議不限制，才能涵蓋所有費用）。
5. **Amount（金額）**：選 **Specified amount**，填一個你能接受的小額，例如 **1 美元（或換算成你結算帳戶幣別的小額，如 NT$30）**。
   幣別必須與結算帳戶相同。
6. **Actions（動作）**：門檻預設是 50%、90%、100%（實際花費）。再按 **ADD THRESHOLD** 加一個 **100%，Forecasted（預測）**，
   這樣「預計會超過」時就會先收到通知。
7. 勾選 **Email alerts to billing admins and users**（預設已勾）。
8. **FINISH** 儲存。

### 或用 gcloud 設定

```bash
BILLING_ACCOUNT=<結算帳戶 ID，例如 0X0X0X-0X0X0X-0X0X0X>   # gcloud billing accounts list
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

gcloud billing budgets create \
  --billing-account="$BILLING_ACCOUNT" \
  --display-name="kot-demo" \
  --budget-amount=1USD \
  --filter-projects="projects/$PROJECT_NUMBER" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.0,basis=forecasted-spend
```

（`--budget-amount` 的幣別要與結算帳戶一致；指令的細節以 `gcloud billing budgets create --help` 為準。）

### 平常怎麼看用量

- Console → **Cloud Run** → 選 `kot-demo` → **Metrics**：看 **Billable instance time**（計費的 instance 時間）。
- Console → **Billing → Reports**：依服務看本月實際花費，並篩選 Cloud Run 的 SKU。

### 想立刻停止對外服務（緊急開關）

```bash
# 移除公開存取（網址會回 403，服務與設定都保留）
gcloud run services remove-iam-policy-binding kot-demo --region asia-east1 \
  --member=allUsers --role=roles/run.invoker

# 恢復
gcloud run services add-iam-policy-binding kot-demo --region asia-east1 \
  --member=allUsers --role=roles/run.invoker

# 完全移除
gcloud run services delete kot-demo --region asia-east1
```

## 5. 驗證清單（請你實測；全部「未實測」）

1. `make demo-image` 成功，`docker image ls kot-demo` 的大小（請回報）。
2. `make demo-run` 後，兩個分頁可以完整玩一局；怪獸是隨機分配的；沒有 console 錯誤。
3. 部署後，用手機與電腦各開一個，連到同一個房間玩一局。
4. 開 6 個分頁建 6 個房間：第 6 個要看到「房間數已達上限」。
5. 開超過 30 個連線：新連線看到「試玩名額已滿」；已在線的人不受影響。
6. 玩超過 60 分鐘（或在 Cloud Run 把 `--timeout` 暫時設小，例如 60，測試）：連線被切斷後是否自動接回同一座位。
7. 讓服務閒置到縮為 0 台，再開網址：冷啟動時間（請回報秒數）。
8. 預算警示建立後，在 Billing 頁面確認有出現，並收到測試通知（若有）。
