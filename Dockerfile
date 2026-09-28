# =============================================================================
# CodeY Website + Market Server
#
# 三阶段构建：
#   web     —— Astro 静态站构建，产出 dist/
#   market  —— Rust market server release 构建
#   runtime —— 只带运行时依赖的最终镜像
#
# 最终镜像里，run-site.mjs 同时承担静态文件服务与 API 反向代理，
# 对外只暴露 4321 一个端口。
#
# 本文件刻意不使用任何 BuildKit 专属语法（如 RUN --mount=type=cache）：
# 部分服务器只装了 docker engine 而没有 buildx 插件，此时 Compose 会回退到
# 传统构建器，遇到 --mount 会直接失败。缓存交给 Docker 的普通层缓存处理。
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: 构建 Astro 静态站
# -----------------------------------------------------------------------------
FROM node:24.12.0-bookworm-slim AS web

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm/bin:/pnpm:$PATH \
    CI=1

# 国内服务器可传 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
#
# 注意大小写：pnpm 读取的是小写 npm_config_registry。写成大写的
# NPM_CONFIG_REGISTRY 不会报错，但也不会生效（仍然走官方源，只是慢）。
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=$NPM_REGISTRY

RUN npm install --global pnpm@11.7.0 && npm cache clean --force

WORKDIR /app

# 项目级 .npmrc，确保 pnpm 一定读到该镜像源（环境变量之外的双保险）
RUN printf 'registry=%s\n' "$NPM_REGISTRY" > /app/.npmrc

# 先只复制清单文件，让依赖层在源码变化时仍能命中缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

WORKDIR /app

# 先只复制清单文件，让依赖层在源码变化时仍能命中缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY astro.config.mjs tsconfig.json ./
COPY public ./public
COPY src ./src

# 只跑 astro build；Rust 部分交给下面的 market 阶段并行完成
RUN pnpm exec astro build

# -----------------------------------------------------------------------------
# Stage 2: 构建 Rust market server
# -----------------------------------------------------------------------------
FROM rust:1.96-bookworm AS market

ARG CARGO_REGISTRY_MIRROR=
WORKDIR /app

# 国内服务器可传 --build-arg CARGO_REGISTRY_MIRROR=https://rsproxy.cn/index/
RUN if [ -n "$CARGO_REGISTRY_MIRROR" ]; then \
        mkdir -p /usr/local/cargo \
        && printf '[source.crates-io]\nreplace-with = "mirror"\n[source.mirror]\nregistry = "sparse+%s"\n' \
            "$CARGO_REGISTRY_MIRROR" > /usr/local/cargo/config.toml; \
    fi

# 依赖只用 rustls 与 bundled sqlite，不需要系统 OpenSSL
COPY Cargo.toml Cargo.lock ./
COPY server ./server

# cargo 按 crate 增量编译；重复构建时 Docker 会复用未变化的层。
# 二进制复制到 /tmp，避免把整个 target 目录带进最终镜像。
RUN cargo build --release -p codey-market-server \
    && cp target/release/codey-market-server /tmp/codey-market-server

# -----------------------------------------------------------------------------
# Stage 3: 运行时
# -----------------------------------------------------------------------------
FROM node:24.12.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    CODEY_WEBSITE_HOST=0.0.0.0 \
    CODEY_WEBSITE_PORT=4321 \
    CODEY_MARKET_UPSTREAM=http://127.0.0.1:8787 \
    CODEY_MARKET_DATA_ROOT=/data

# ca-certificates 是必需的：slim 镜像不含根证书，而 reqwest 使用
# rustls-native-certs 后端，缺少证书时 Client::builder().build() 会直接失败
# （报 InvalidConfiguration("builder error")），服务在监听后立即退出。
# curl 供健康检查使用；tini 负责正确转发信号；gosu 供入口脚本降权。
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gosu tini \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 构建产物：静态站、Rust 二进制、以及运行入口脚本
COPY --from=web /app/dist ./dist
COPY --from=market /tmp/codey-market-server ./.codey-market/target/release/codey-market-server
COPY scripts/run-site.mjs ./scripts/run-site.mjs
COPY deploy/docker-entrypoint.sh ./docker-entrypoint.sh
COPY package.json ./

RUN chmod +x ./docker-entrypoint.sh \
    && mkdir -p /data \
    && chown -R node:node /data /app

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:4321/ >/dev/null || exit 1

# 入口以 root 启动以修正 bind mount 属主，随后自行降权到 node
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "scripts/run-site.mjs", "start"]
