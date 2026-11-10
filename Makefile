# King of Tokyo 常用指令。
#
# 試玩 image 只在明確執行 `make demo-image` 時才會建置；
# `make build`、`make test`、docker compose、CI 都不會建它。
# 相容性：GNU Make 3.81（macOS 內建）。

IMAGE ?= kot-demo
PORT  ?= 8080

.PHONY: help install check test build demo-image demo-run

help:
	@echo "make install     安裝依賴（pnpm install --frozen-lockfile）"
	@echo "make check       提交前完整檢查（baseline + format + lint + typecheck + test + build）"
	@echo "make test        只跑測試"
	@echo "make build       只建置全部套件"
	@echo "make demo-image  建置單一容器的試玩 image（$(IMAGE)）；沒有資料庫、房間上限 5、連線上限 30"
	@echo "make demo-run    在本機跑試玩 image（http://localhost:$(PORT)）"

install:
	pnpm install --frozen-lockfile

check:
	pnpm run check

test:
	pnpm run test

build:
	pnpm run build

# 在 Intel Mac 上建置的 image 本來就是 linux/amd64（Cloud Run 要的架構）。
# 若在 Apple Silicon 上建置，需加 --platform linux/amd64。
demo-image:
	docker build --target demo -t $(IMAGE) .
	@docker image ls $(IMAGE)

demo-run:
	docker run --rm -p $(PORT):8080 --name kot-demo $(IMAGE)
