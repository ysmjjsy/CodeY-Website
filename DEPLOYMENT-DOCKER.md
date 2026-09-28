# CodeY 官网 Docker 部署指南

本文档用于通过 Docker Compose 在一台 Linux 服务器上部署 CodeY 官网、模板市场与
Cloud 商业域。相比 `DEPLOYMENT.md` 的 systemd 方案，本方案把 Node、Rust、Caddy
全部收进容器，服务器只需要安装 Docker。

示例使用：

- 域名 `codey.ysmjjsy.com`（Cloudflare 代理，橙云开启）
- 源站 `39.105.2.5`
- 项目目录 `/data/ysmjjsy/CodeY-Website`
- PostgreSQL 宿主机端口 `14210`

## 1. 部署结构

```text
浏览器
  │ HTTPS :443
  ▼
Cloudflare（Full strict）
  │ HTTPS :443
  ▼
caddy 容器（80/443）
  │ HTTP app:4321（compose 网络）
  ▼
app 容器
  ├── dist/ 静态文件
  ├── /.well-known/codey-market.json
  ├── /.well-known/codey-cloud.json
  └── /api/market/v1/*、/api/cloud/v1/* → market server 127.0.0.1:8787（容器内）
                                              │
                                              └── PostgreSQL 39.105.2.5:14210/codey
```

app 容器内同时运行 Astro 静态站服务与 Rust market server。caddy 通过 compose 网络
按服务名 `app` 访问它，`4321` 仅额外绑定到宿主机回环地址供调试，公网只开放
`80` 和 `443`。

## 2. 前置条件

服务器需要：

- Docker Engine 24+ 与 Docker Compose v2 插件
- 约 4 GB 可用内存（Rust release 构建较吃内存）
- 能访问 npm 与 crates.io（国内服务器建议用镜像源，见第 4 节）

检查：

```bash
docker version
docker compose version
```

PostgreSQL 需要已经建好 `codey` 数据库：

```bash
PGPASSWORD='<密码>' psql --host=127.0.0.1 --port=14210 --username=goya \
  --dbname=postgres -c 'CREATE DATABASE codey;'
```

表结构不需要手工创建，服务启动时会幂等建表。

## 3. 获取代码

```bash
mkdir -p /data/ysmjjsy
cd /data/ysmjjsy
git clone git@github.com:ysmjjsy/CodeY-Website.git
cd CodeY-Website
```

## 4. 配置环境变量

```bash
cp .env.docker.example .env
chmod 600 .env
```

编辑 `.env`，至少填写以下四项：

```bash
# 公开地址，必须是 https，否则写操作 Origin 校验失败且 Cookie 不带 Secure
CODEY_WEBSITE_ORIGIN=https://codey.ysmjjsy.com

# 容器内的 127.0.0.1 指向容器自身，宿主机上的 PostgreSQL 必须用 host.docker.internal
CODEY_DATABASE_URL=postgresql://goya:<密码>@host.docker.internal:14210/codey

# openssl rand -base64 32
CODEY_CLOUD_SECRET_KEY=<base64 的 32 字节密钥>

# 必须 10-128 字节，否则服务拒绝启动
CODEY_MARKET_ADMIN_PASSWORD=<强密码>
```

其余可选配置的约束：

| 变量组 | 约束 |
| --- | --- |
| `CODEY_MARKET_GITHUB_CLIENT_ID` / `_SECRET` | 必须同时填或同时留空 |
| `CODEY_REGISTRATION_SMTP_HOST` / `_EMAIL_FROM` | 必须同时填或同时留空；留空则关闭注册 |
| `CODEY_REGISTRATION_SMTP_USERNAME` / `_PASSWORD` | 必须同时填或同时留空 |
| `CODEY_REGISTRATION_SMTP_SECURITY` | 只能是 `tls` / `starttls` / `none`；465 用 `tls`，587 用 `starttls` |
| 支付渠道各组 | 每组要么全填要么全空，否则服务拒绝启动 |
| `CODEY_WECHAT_PAY_API_V3_KEY` | 必须恰好 32 字节 |
| `CODEY_CLOUD_DEFAULT_TIMEZONE` | 必须是合法 IANA 名称，如 `Asia/Shanghai` |

> `CODEY_MARKET_ADMIN_GITHUB_LOGINS` 多个用户名必须用**英文逗号**分隔。
> 用空格分隔会被当成一个不存在的用户名，管理员权限静默失效。

## 5. 配置 TLS 证书

caddy 需要一个证书来接受 Cloudflare 的回源 HTTPS 连接。两种做法：

### 方案 A：自动申请 Origin Certificate（推荐）

用脚本调用 Cloudflare API 申请，证书 15 年有效，不需要手工下载粘贴。

1. 在 Cloudflare 后台创建 API Token（My Profile → API Tokens → Create Token），
   权限需要两条：

   ```text
   Zone → SSL and Certificates → Edit     （申请/吊销证书）
   Zone → Zone → Read                     （自动查找 zone id）
   ```

   Zone Resources 选 `Include → Specific zone → ysmjjsy.com`，把权限限制在单个域名。

2. 让脚本读到 Token，二选一：

   ```bash
   # 方式一：环境变量
   export CLOUDFLARE_API_TOKEN='你的-token'

   # 方式二：写入文件（已被 .gitignore 忽略）
   echo '你的-token' > deploy/.cloudflare-token
   chmod 600 deploy/.cloudflare-token
   ```

3. 申请证书：

   ```bash
   ./deploy/fetch-origin-cert.sh
   ```

   脚本会从 `.env` 的 `CODEY_WEBSITE_ORIGIN` 推导域名，在本机生成私钥与 CSR，
   只把 CSR 发给 Cloudflare，**私钥不会离开服务器**。证书写入
   `deploy/certs/codey.pem` 与 `codey.key`（权限 600）。

   常用参数：

   ```bash
   ./deploy/fetch-origin-cert.sh --force                 # 强制重新申请
   ./deploy/fetch-origin-cert.sh --domain codey.example.com
   ./deploy/fetch-origin-cert.sh --validity 365          # 默认 5475 天
   ```

   脚本在证书 30 天内不会过期时自动跳过，可安全地放进定时任务。因为 Token 存在
   `deploy/.cloudflare-token` 时脚本会自动读取，cron 里不需要写凭据：

   ```bash
   # 每月 1 日凌晨检查一次，接近到期时自动续期并重载 caddy
   0 4 1 * * cd /data/ysmjjsy/CodeY-Website && \
     ./deploy/fetch-origin-cert.sh && \
     docker compose up -d --force-recreate caddy
   ```

   注意 Cloudflare **不会**发送 Origin CA 证书的到期提醒，需要自己跟踪。

### 方案 B：手工下载

Cloudflare 后台 → SSL/TLS → Origin Server → Create Certificate，
主机名填 `codey.ysmjjsy.com`，把证书存为 `deploy/certs/codey.pem`、
私钥存为 `deploy/certs/codey.key`：

```bash
mkdir -p deploy/certs
vi deploy/certs/codey.pem
vi deploy/certs/codey.key
chmod 600 deploy/certs/codey.key
```

> 私钥在 Cloudflare 后台**只显示一次**，关掉页面就再也看不到，必须当场保存。
> 这也是方案 A 更省事的原因。

### 方案 C：不用证书

编辑 `deploy/Caddyfile`，注释掉 `tls /etc/caddy/certs/...` 一行，启用
`tls internal`，并把 Cloudflare 的 SSL/TLS 模式从 Full (strict) 改成 Full。

## 6. 构建并启动

```bash
docker compose up -d --build
```

国内服务器建议使用镜像源加速：

```bash
docker compose build \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg CARGO_REGISTRY_MIRROR=https://rsproxy.cn/index/
docker compose up -d
```

首次构建需要编译 300+ 个 Rust crate，耗时较长（视机器性能约 5–15 分钟）。

查看状态与日志：

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f caddy
```

### 关于 ./data 目录权限

应用以 uid 1000 (`node`) 运行。Docker 在 Linux 上自动创建不存在的 bind mount
宿主目录时属主是 `root`，应用会因此无法写入。镜像内的
`deploy/docker-entrypoint.sh` 以 root 启动、修正该目录属主后自动降权到 `node`，
所以**不需要手工 chown**。可用以下命令确认降权生效：

```bash
docker compose exec app sh -c 'for p in /proc/[0-9]*; do \
  cmd=$(tr "\0" " " < "$p/cmdline" 2>/dev/null); \
  case "$cmd" in *run-site*|*codey-market-server*) \
  echo "uid=$(awk "/^Uid:/{print \$2}" "$p/status") $cmd";; esac; done'
```

两个业务进程都应显示 `uid=1000`。

## 7. Cloudflare 设置

| 项 | 值 | 说明 |
| --- | --- | --- |
| SSL/TLS 模式 | **Full (strict)** | 用 Flexible 会回源 HTTP，与应用基于 https 的 Origin 判断冲突 |
| Always Use HTTPS | On | |
| 缓存规则 | Bypass `/api/*` 与 `/.well-known/*` | Cloudflare 默认按扩展名缓存 `.json`，会缓存住 discovery 与 API 响应 |

代理状态（橙云）保持开启。caddy 容器映射宿主机 `80`/`443`，因此这两个端口
必须在阿里云安全组放行。

### 真实客户端 IP

caddy 会把 Cloudflare 注入的 `CF-Connecting-IP` 还原为 `X-Real-IP` 与
`X-Forwarded-For` 再转发给应用。这一步不能省：应用按该地址对注册验证码限流，
若直接透传 TCP 对端地址，所有访客会共用 Cloudflare 边缘节点 IP，被一起限流。

`CF-Connecting-IP` 由 Cloudflare 注入且访客无法伪造，因此可以安全信任。
未经 Cloudflare 的直连请求会回退到 TCP 对端地址。

### 上传大小限制

应用允许最大 **512 MB** 的 `.codeypkg` 上传。Cloudflare 免费与 Pro 计划的
请求体上限是 100 MB，超过的上传会在边缘被拒绝。需要上传大包时，应让上传走
不经过 Cloudflare 的通道，或升级到 Business 计划。

## 8. 配置 GitHub OAuth

在 GitHub OAuth App 中把回调地址改为：

```text
https://codey.ysmjjsy.com/api/market/v1/auth/github/callback
```

回调地址必须与 `CODEY_WEBSITE_ORIGIN` 完全一致，否则登录后跳回错误地址。

修改 `.env` 后需要重建容器才能生效：

```bash
docker compose up -d --force-recreate app
```

## 9. 部署验证

```bash
curl --fail --show-error http://127.0.0.1:4321/
curl --fail --show-error http://127.0.0.1:4321/.well-known/codey-market.json
curl --fail --show-error https://codey.ysmjjsy.com/
curl --fail --show-error https://codey.ysmjjsy.com/api/market/v1/listings
```

浏览器验证：

1. 打开 `https://codey.ysmjjsy.com/market/`
2. 用 `CODEY_MARKET_ADMIN_USERNAME` / `_PASSWORD` 登录
3. 进入 `/console/` 检查套餐、积分与模板状态
4. 完成 GitHub OAuth 登录（如已配置）

## 10. 更新版本

```bash
./deploy/docker-deploy.sh
```

脚本会检查 `.env` 与证书、`git pull`、重建镜像、滚动重启并做健康检查。

手工更新：

```bash
git pull --ff-only
docker compose up -d --build
```

## 11. 数据备份

需要备份两样东西，缺一不可。

**PostgreSQL**（账号、会话、市场、Cloud 业务数据）：

```bash
PGPASSWORD='<密码>' pg_dump --host=127.0.0.1 --port=14210 --username=goya \
  --format=custom --file=/var/backups/codey.dump codey
```

**`./data` 目录**（模板文件与签名密钥）：

```bash
docker compose stop app
tar -czf /var/backups/codey-market.tar.gz -C . data
docker compose start app
```

`data/cloud-entitlement-ed25519.pk8` 是 Desktop 校验模型目录的 Ed25519 私钥。
**该文件丢失会导致所有已下发的模型授权失效**，且重新生成会更换公钥。它不能
从数据库恢复，必须单独备份。

备份文件应同步到服务器之外的存储位置。

## 12. 常见问题

### 部署后公网返回 521

Cloudflare 连不上源站。检查 caddy 容器是否运行、80/443 是否放行：

```bash
docker compose ps
ss -lntp | grep -E ':(80|443)\b'
```

### 页面能打开但登录、上传报 "Request origin is not allowed"

浏览器地址与 `CODEY_WEBSITE_ORIGIN` 不一致。以下都是不同 Origin：

```text
http://codey.ysmjjsy.com
https://codey.ysmjjsy.com
https://www.codey.ysmjjsy.com
https://codey.ysmjjsy.com:4321
```

生产只保留一个规范域名，统一使用 HTTPS。

### 服务启动即退出，日志显示 InvalidConfiguration

常见原因：

```text
CODEY_MARKET_ADMIN_PASSWORD must contain 10-128 bytes
CODEY_REGISTRATION_SMTP_SECURITY must be tls, starttls, or none
CODEY_CLOUD_DEFAULT_TIMEZONE must be an IANA timezone
payment configuration group is incomplete: ...
```

按提示修正 `.env` 后 `docker compose up -d --force-recreate app`。

### 数据库连接失败

容器内的 `127.0.0.1` 是容器自身。宿主机上的 PostgreSQL 必须用
`host.docker.internal`，并确认 PostgreSQL 监听 `0.0.0.0` 或 Docker 网桥地址
（`listen_addresses`）以及 `pg_hba.conf` 允许该网段。

```bash
docker compose exec app node -e "console.log(process.env.CODEY_DATABASE_URL)"
```

### 修改 .env 后没有生效

Compose 只在容器创建时注入环境变量：

```bash
docker compose up -d --force-recreate app
```
