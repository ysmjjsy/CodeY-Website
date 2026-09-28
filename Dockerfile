# syntax=docker/dockerfile:1

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
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: 构建 Astro 静态站
# -----------------------------------------------------------------------------
FROM node:24.12.0-bookworm-slim AS web

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm/bin:/pnpm:$PATH \
    CI=1

# 国内服务器可传 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=$NPM_REGISTRY

RUN npm install --global pnpm@11.7.0 && npm cache clean --force

WORKDIR /app

# 先只复制清单文件，让依赖层在源码变化时仍能命中缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-web,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

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

# cargo 自身按 crate 增量编译，registry/target 用缓存挂载加速重复构建。
# target 是缓存挂载（不落镜像层），所以构建完必须把二进制复制出去。
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=cargo-target,target=/app/target \
    cargo build --release -p codey-market-server \
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
