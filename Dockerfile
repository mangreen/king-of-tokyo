# King of Tokyo — 多階段 Dockerfile
#
# 相容性：Docker Engine 20.10 / Docker Desktop 4.12。
# 不使用 BuildKit 專屬語法（--mount、heredoc、# syntax= 指令），經典 builder 也能建置。
#
# 目標（--target）：
#   dev     開發用：已安裝完整依賴，compose 以 bind mount 掛入原始碼
#   build   建置全部套件
#   server  正式環境的遊戲伺服器（非 root、僅含 production 依賴）
#   web     正式環境的靜態網站（nginx）

# ---------- base ----------
FROM node:22-alpine AS base
WORKDIR /app
# 版本由 package.json 的 packageManager 欄位固定
RUN corepack enable

# 所有 package.json 與 lockfile 先複製，依賴層才能在原始碼變動時被快取
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/rules/package.json packages/rules/
COPY packages/protocol/package.json packages/protocol/
COPY packages/cardsets/package.json packages/cardsets/
COPY packages/room/package.json packages/room/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# ---------- dev ----------
FROM manifests AS dev
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3001 5173

# ---------- build ----------
FROM dev AS build
RUN pnpm -r build

# ---------- server（正式）----------
FROM manifests AS server-deps
RUN pnpm install --frozen-lockfile --prod --filter @kot/server...

# 乾淨的 runtime：從原始 node 映像重新開始，不帶 corepack 下載的 pnpm，
# 並移除執行時用不到的套件管理器（npm、yarn、corepack）。
# 原因：Snyk 容器掃描的高風險項目都在這些工具自帶的依賴，而不是應用程式本身；
# 移除後攻擊面與掃描雜訊一起消失。伺服器只需要 node 與已打包的 dist。
FROM node:22-alpine AS server
ENV NODE_ENV=production
RUN rm -rf /usr/local/lib/node_modules \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=server-deps /app/apps/server/node_modules ./apps/server/node_modules
# package.json 必須在：其中的 "type": "module" 決定 dist/main.js 以 ESM 載入
COPY apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
# 只帶原創卡組；使用者自備的 card-sets/local 絕不進映像（見 .dockerignore）。
# 需要自備卡組時，以唯讀 volume 掛到 /app/card-sets/local。
COPY card-sets/original ./card-sets/original
ENV CARD_SETS_DIR=/app/card-sets
USER node
WORKDIR /app/apps/server
EXPOSE 3001
CMD ["node", "dist/main.js"]

# ---------- web（正式）----------
FROM nginx:stable-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

# ---------- demo（單一容器的試玩版，部署到 Cloud Run）----------
# 伺服器直接提供網頁（同一個網址與埠），房間與玩家都在記憶體，沒有資料庫。
# 只有明確執行 `make demo-image`（docker build --target demo）才會建置；
# docker compose 與 CI 都不會碰它。
FROM dev AS demo-build
# VITE_SERVER_URL 設成空字串＝網頁連同一個網址；不帶 sourcemap；預先壓縮
RUN pnpm --filter @kot/server build \
    && VITE_SERVER_URL= VITE_NO_SOURCEMAP=1 pnpm --filter @kot/web build \
    && node scripts/precompress.mjs apps/web/dist

FROM node:22-alpine AS demo
RUN rm -rf /usr/local/lib/node_modules \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=server-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY apps/server/package.json ./apps/server/package.json
COPY --from=demo-build /app/apps/server/dist ./apps/server/dist
COPY --from=demo-build /app/apps/web/dist ./web
# 只帶原創卡組；使用者自備的卡表絕不進映像（見 .dockerignore）
COPY card-sets/original ./card-sets/original
# 限制：同時最多 5 個房間、30 個連線，保護 Cloud Run 免費額度。
# PORT 由 Cloud Run 注入（預設 8080）；ALLOWED_ORIGINS 保留預設值，但同來源一律放行。
ENV NODE_ENV=production \
    CARD_SETS_DIR=/app/card-sets \
    WEB_DIR=/app/web \
    ALLOW_SAME_ORIGIN=true \
    MAX_ROOMS=5 \
    MAX_CONNECTIONS=30 \
    IDLE_KICK_MS=300000 \
    PORT=8080
USER node
WORKDIR /app/apps/server
EXPOSE 8080
CMD ["node", "dist/main.js"]
