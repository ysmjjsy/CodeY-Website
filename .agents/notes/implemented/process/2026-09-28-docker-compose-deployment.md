# Agent Note: 用 Docker Compose 部署官网

Status: implemented

## Problem

`DEPLOYMENT.md` 描述的部署路径要求目标服务器同时具备 Node 24.12、pnpm 11.7、Rust 1.96、
systemd 和一个宿主机的 Caddy。这套组合对一台已经用 Docker 运行其它服务的服务器是重复的：
镜像、反向代理、TLS 三条链路都要在宿主机上再铺一遍，而且 `pnpm build` 会在服务器上
现场编译 300+ 个 Rust crate，把工具链版本变成部署的前置条件。

实际部署目标（阿里云 ECS，`/data/ysmjjsy/CodeY-Website`）已经装了 Docker，并已用
Docker 跑过 Caddy、PostgreSQL、new-api 等服务。在这台机器上，"再装一套 Node + Rust +
Caddy" 不是最省事的路径，而是最容易与既有服务抢端口、抢工具链版本的路径。

同时，网站现在要访问的 PostgreSQL 位于宿主机端口 `14210`，而 systemd 方案里
`CODEY_DATABASE_URL` 直接写 `127.0.0.1` —— 这个地址在容器内指向容器自身，是容器化
之后必须显式处理的新问题。

## Decision

新增 `Dockerfile`、`docker-compose.yml`、`.dockerignore`、`.env.docker.example`、
`deploy/Caddyfile`、`deploy/docker-entrypoint.sh`、`deploy/docker-deploy.sh`、
`deploy/fetch-origin-cert.sh`，并把流程写进 `DEPLOYMENT-DOCKER.md`。`DEPLOYMENT.md`
的 systemd 路径保留不变。

三个执行阶段：

- `web` —— `node:24.12.0-bookworm-slim`，`pnpm install --frozen-lockfile` 后只跑
  `astro build`，产出 `dist/`。
- `market` —— `rust:1.96-bookworm`，`cargo build --release -p codey-market-server`。
- `runtime` —— 只带 `dist/`、编译好的二进制、`scripts/run-site.mjs`，以非 root 的
  `node` 用户运行。

`app` 容器内同时跑静态站与 market server，对外只暴露 `4321`；`caddy` 服务在同一个
compose 网络里按服务名 `app` 反代它，并映射宿主机的 `80`/`443`。数据库走
`host.docker.internal:14210`，由 compose 的 `host-gateway` 映射提供。

实现过程中修正了三个必须同时落地的细节，它们不是可选优化：

1. **运行时镜像必须装 `ca-certificates`。** slim 镜像不含根证书，而 reqwest 使用
   `rustls-native-certs` 后端；缺少证书时 `Client::builder().build()` 直接失败，服务
   打印完 "listening" 就退出，报 `InvalidConfiguration("builder error")`。
2. **入口脚本要修正数据目录属主。** Docker 在 Linux 上创建不存在的 bind mount 目录时
   属主是 `root`，而应用以 uid 1000 运行，`/data` 下写不了 entitlement 签名密钥。
   `deploy/docker-entrypoint.sh` 以 root 启动、`chown` 后 `gosu node` 降权。
3. **Caddy 必须还原 `CF-Connecting-IP`。** 应用优先读 `x-real-ip` 做注册验证码限流
   （`server/market-server/src/lib.rs` 的 `registration_source_hash`）。若透传 TCP 对端
   地址，橙云后面所有访客共用 Cloudflare 边缘节点 IP，会被一起限流。

`.env`、`deploy/certs/`、`deploy/.cloudflare-token` 加进 `.gitignore`：原来的规则只精确
匹配 `.env.local`，而 compose 用的是 `.env`，不补就会把数据库密码提交上去。

## Alternatives considered

- **沿用 `DEPLOYMENT.md` 的 systemd + 宿主 Caddy。** 这是仓库原有且已验证的路径，对一台
  干净的 Ubuntu 服务器是最少活动的方案；文档已经写好，不需要新增任何文件。被否决是因为
  它和这台服务器的现状冲突：宿主机上 80/443 已经属于 Docker 里的既有 Caddy，再装一个
  宿主 Caddy 会抢端口；而为了 `pnpm build` 还要在宿主机装 Rust 1.96，把"服务器上有什么
  工具链"变成部署正确性的一部分。容器把这三个版本一次性固定下来。

- **把 PostgreSQL 也放进 compose。** 自包含、可复现、`docker compose up` 一条命令起全套，
  对新机器是最省心的形态。被否决是因为数据已经存在于宿主机的 PostgreSQL（端口 `14210`，
  与 new-api、sub2api 等既有服务共库）。新建一个数据库容器意味着要么迁移既有数据，要么
  让线上账号/套餐数据分叉成两份，两者都比"连过去"代价高得多。compose 因此只用外部库。

- **用 `network_mode: host` 跑 caddy。** 这是最初实现，能省掉 compose 网络的解析，
  并让 `127.0.0.1:4321` 直接可达。被否决有两个原因：一是 host 网络在 Docker Desktop
  上不生效，本地无法验证交付物；二是桥接网络下 caddy 本来就是边缘，`{remote_host}`
  的语义更清楚。改成桥接后 caddy 通过服务名 `app:4321` 访问，反而少了一层对宿主机
  端口绑定的隐式依赖。

- **让 Caddy 直接签 Let's Encrypt，不配任何证书。** Caddy 的默认行为就是自动 ACME，
  零配置，理论上最省事。被否决是因为源站处在 Cloudflare 橙云之后：HTTP-01 挑战会被
  Cloudflare 代理，`Always Use HTTPS` 会把它重定向到源站的 HTTPS，而源站此时还没有
  可信证书，形成闭环。`tls internal` 自签名可以绕开，但要求把 SSL/TLS 模式从
  Full (strict) 降到 Full。

- **Origin Certificate 走手工下载。** Cloudflare 后台的创建流程直观，不引入任何脚本和
  API 凭据，是一次性成本。被否决是因为私钥在后台只显示一次、关掉页面即不可再取，且
  Cloudflare 不对 Origin CA 证书发送到期提醒；把这两点交给一个可重复执行的脚本更稳妥。
  `deploy/fetch-origin-cert.sh` 因此在本机生成私钥与 CSR，只把 CSR 发给 API，私钥不
  离开服务器。脚本用 API Token 而不是 Origin CA Key —— 后者已废弃，2026-09-30 停止服务。

## Consequences

- **收益**：服务器只需要 Docker。Node、Rust、Caddy 的版本由镜像固定，不再依赖宿主机
  装了什么。`docker compose up -d --build` 是完整的部署动作。
- **收益**：构建产物与运行时依赖分层，`dist/` 与二进制是镜像层的一部分，部署不再需要
  在服务器上保留 `node_modules` 或 `cargo` 的中间态。
- **代价**：新增 9 个文件与一套并行的部署文档（`DEPLOYMENT-DOCKER.md`）。两条路径
  描述同一个应用，将来改 `run-site.mjs` 的调用方式或端口时，两处都要同步。
- **代价**：镜像构建需要约 4 GB 内存，首次编译 300+ 个 Rust crate 在低配实例上会
  很慢甚至 OOM；国内服务器不加镜像源参数会明显更慢，因此 `NPM_REGISTRY` 与
  `CARGO_REGISTRY_MIRROR` 做成了 build arg。
- **代价**：`data/` 目录是 bind mount，备份脚本要同时覆盖 PostgreSQL 与该目录。其中
  `cloud-entitlement-ed25519.pk8` 无法从数据库恢复，丢失会导致已下发的 Desktop 模型
  授权全部失效。
- **代价**：`.dockerignore` 排除了 `*.md`，因此文档不会进入镜像。这降低了镜像体积，
  但也意味着镜像内无法查阅 `DEPLOYMENT-DOCKER.md`。

## Verification

- `docker build` 完整通过（`web`、`market`、`runtime` 三阶段），镜像内 `dist/`、
  `codey-market-server` 二进制、`scripts/run-site.mjs` 均存在且属主为 `node`。
- 以真实 compose 文件启动 `app` + `caddy`，经 443 用 CA 校验证书链（非 `-k`）访问：
  `/` → 200、`/.well-known/codey-market.json` → 200 且 `webBaseUrl` 为
  `https://codey.ysmjjsy.com/market`、`/api/market/v1/listings` → 200。
- `POST /api/market/v1/auth/login` → 200，且 `Set-Cookie` 含 `Secure`，证明
  `CODEY_WEBSITE_ORIGIN` 的 https 判断链路生效。
- 容器内 `/proc/*/status` 核对：`run-site.mjs` 与 `codey-market-server` 两个进程均为
  `uid=1000`，只有 `tini` 是 root。
- `deploy/fetch-origin-cert.sh` 对着自建 mock API（用测试 CA 真签收到的 CSR）验证：
  正常签发、CSR 换行完整（mock 拒绝换行数 < 5）、`jq`/`python3`/`node` 三种 JSON
  后端分别用裁剪 PATH 屏蔽上游工具后单独跑通、幂等跳过、以及 zone 缺失与 API 业务报错
  两条失败路径。
- `caddy validate` 在 Origin Certificate 与 `tls internal` 两种 TLS 方案下均通过。
- `docker compose config` 通过；`.env`、`deploy/certs/`、`deploy/.cloudflare-token`
  经 `git check-ignore` 确认被忽略。
