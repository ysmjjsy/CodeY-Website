# CodeY 官网部署指南

本文档用于将 CodeY 官网和模板市场部署到一台 Linux 服务器。

示例使用：

- Ubuntu
- Caddy
- 域名 `codey.example.com`
- 官网目录 `/opt/codey/CodeY-Website`
- 模板市场数据目录 `/var/lib/codey-market`

部署时请将示例域名替换为真实域名。

## 1. 部署结构

```text
浏览器
  │
  │ HTTPS :443
  ▼
Caddy
  │
  │ HTTP
  ▼
CodeY 官网统一入口 127.0.0.1:4321
  ├── 官网静态文件
  ├── /.well-known/codey-market.json
  └── /api/market/v1/* → Market Server 127.0.0.1:8787
                              │
                              └── PostgreSQL 39.105.2.5:15432/codey
```

官网和模板市场 API 使用同一个公开域名。前端通过相对路径访问 API，不需要配置
`PUBLIC_MARKET_API_URL`。

端口 `4321` 和 `8787` 只监听本机。公网只开放 `80` 和 `443`。

## 2. 部署前置条件

服务器需要安装：

- Node.js 24
- pnpm 11.7
- Rust 1.96
- Git
- Caddy

检查版本：

```bash
node --version
pnpm --version
rustc --version
cargo --version
caddy version
```

官网不依赖 CodeY 桌面端仓库或外部格式仓库。Market Server 在本仓库内独立实现
`.codeypkg` v1 读取与校验，Cargo 构建不需要获取其他 CodeY 仓库。

## 3. 配置公开 Origin

生产环境的监听地址和公开地址不是同一个概念：

```text
监听地址：http://127.0.0.1:4321
公开地址：https://codey.example.com
```

`scripts/run-site.mjs` 支持独立的 `CODEY_WEBSITE_ORIGIN` 配置，并使用它生成：

- 模板市场页面地址
- 模板市场 API 地址
- GitHub OAuth 回调地址
- 允许提交登录、注册、上传和审核请求的 Origin
- HTTPS 会话 Cookie

期望配置：

```bash
CODEY_WEBSITE_HOST=127.0.0.1
CODEY_WEBSITE_PORT=4321
CODEY_WEBSITE_ORIGIN=https://codey.example.com
```

该值必须是完整 Origin，只能包含协议、域名和可选端口，不能包含路径、查询参数或片段。

## 4. 创建运行用户和目录

```bash
sudo useradd --system --create-home --home-dir /var/lib/codey --shell /usr/sbin/nologin codey
sudo mkdir -p /opt/codey /etc/codey /var/lib/codey-market
sudo chown -R codey:codey /opt/codey /var/lib/codey-market
```

将官网仓库放入 `/opt/codey`：

```text
/opt/codey/CodeY-Website
```

## 5. 安装依赖并构建

```bash
cd /opt/codey/CodeY-Website
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` 会同时：

- 构建 Astro 官网到 `dist/`
- 以 release 模式构建 `codey-market-server`

默认的 Market Server 可执行文件位于：

```text
/opt/codey/CodeY-Website/.codey-market/target/release/codey-market-server
```

## 6. 创建生产环境配置

创建 `/etc/codey/website.env`：

```bash
CODEY_WEBSITE_HOST=127.0.0.1
CODEY_WEBSITE_PORT=4321
CODEY_WEBSITE_ORIGIN=https://codey.example.com

CODEY_MARKET_UPSTREAM=http://127.0.0.1:8787
CODEY_MARKET_DATA_ROOT=/var/lib/codey-market
CODEY_DATABASE_URL=postgresql://goya:change-me@39.105.2.5:15432/codey
CODEY_CLOUD_ENTITLEMENT_KEY_ID=codey-cloud-v1
# 可选。留空时会在 CODEY_MARKET_DATA_ROOT 下生成并持久化签名密钥。
CODEY_CLOUD_ENTITLEMENT_SIGNING_KEY=

CODEY_MARKET_GITHUB_CLIENT_ID=
CODEY_MARKET_GITHUB_CLIENT_SECRET=
CODEY_MARKET_ADMIN_GITHUB_LOGINS=
CODEY_MARKET_ADMIN_USERNAME=admin
CODEY_MARKET_ADMIN_PASSWORD=change-me
```

如果暂时不启用 GitHub 登录，保持三个 GitHub 配置为空。

如果启用 GitHub 登录：

```bash
CODEY_MARKET_GITHUB_CLIENT_ID=github-oauth-client-id
CODEY_MARKET_GITHUB_CLIENT_SECRET=github-oauth-client-secret
CODEY_MARKET_ADMIN_GITHUB_LOGINS=admin-github-login
```

多个管理员 GitHub 用户名使用英文逗号分隔：

```bash
CODEY_MARKET_ADMIN_GITHUB_LOGINS=admin-one,admin-two
```

限制配置文件权限：

```bash
sudo chown root:codey /etc/codey/website.env
sudo chmod 640 /etc/codey/website.env
```

不要把数据库密码、GitHub Client Secret 和生产管理员密码写入 Git 仓库。

## 7. 配置 systemd

创建 `/etc/systemd/system/codey-website.service`：

```ini
[Unit]
Description=CodeY Website and Marketplace
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=codey
Group=codey
WorkingDirectory=/opt/codey/CodeY-Website
EnvironmentFile=/etc/codey/website.env
ExecStart=/usr/bin/node /opt/codey/CodeY-Website/scripts/run-site.mjs start
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

确认 Node.js 的实际路径：

```bash
command -v node
```

如果结果不是 `/usr/bin/node`，修改 `ExecStart`。

加载并启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now codey-website
sudo systemctl status codey-website
```

查看日志：

```bash
sudo journalctl -u codey-website -f
```

## 8. 配置 Caddy 和 HTTPS

先把域名的 `A` 或 `AAAA` 记录指向服务器。

编辑 `/etc/caddy/Caddyfile`：

```caddyfile
codey.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4321
}
```

检查并加载配置：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy
```

Caddy 会自动申请和续期 HTTPS 证书。

防火墙只需开放：

```text
TCP 80
TCP 443
```

不要向公网开放 `4321` 和 `8787`。

## 9. 配置 GitHub OAuth

在 GitHub OAuth App 中填写：

```text
Homepage URL:
https://codey.example.com

Authorization callback URL:
https://codey.example.com/api/market/v1/auth/github/callback
```

回调地址必须与生产域名和协议完全一致。

修改 `/etc/codey/website.env` 后重启服务：

```bash
sudo systemctl restart codey-website
```

`CODEY_MARKET_ADMIN_GITHUB_LOGINS` 中的 GitHub 用户登录后会获得管理员权限。
本地管理员由 `CODEY_MARKET_ADMIN_USERNAME` 和 `CODEY_MARKET_ADMIN_PASSWORD` 配置，
服务重启时会自动创建账号或更新密码。

## 10. 部署验证

检查本地统一入口：

```bash
curl --fail --show-error http://127.0.0.1:4321/
curl --fail --show-error http://127.0.0.1:4321/.well-known/codey-market.json
```

检查公网入口：

```bash
curl --fail --show-error https://codey.example.com/
curl --fail --show-error https://codey.example.com/.well-known/codey-market.json
curl --fail --show-error https://codey.example.com/api/market/v1/listings
```

再通过浏览器验证：

1. 打开 `https://codey.example.com/market/`
2. 使用用户名和密码注册、登录
3. 退出后使用邮箱和密码登录
4. 完成 GitHub OAuth 登录
5. 普通用户上传模板
6. 从账号菜单进入控制台，检查套餐、积分和自己的模板状态
7. 管理员账号进入模板审核菜单并完成审核
8. 审核通过的模板出现在公开市场

浏览器请求的 `Origin` 应为：

```text
https://codey.example.com
```

## 11. 更新版本

更新官网后重新构建：

```bash
cd /opt/codey/CodeY-Website
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart codey-website
```

检查服务和日志：

```bash
sudo systemctl status codey-website
sudo journalctl -u codey-website --since "10 minutes ago"
```

## 12. 数据备份

账号、会话、模板市场和 Cloud 业务数据位于 PostgreSQL 的 `codey` 数据库。
待审核和已发布的模板文件位于：

```text
/var/lib/codey-market
```

为取得数据库与模板文件的一致快照，备份前停止服务：

```bash
sudo systemctl stop codey-website
PGPASSWORD='数据库密码' pg_dump \
  --host=39.105.2.5 \
  --port=15432 \
  --username=goya \
  --format=custom \
  --file=/var/backups/codey.dump \
  codey
sudo tar -C /var/lib -czf /var/backups/codey-market.tar.gz codey-market
sudo systemctl start codey-website
```

应将备份文件同步到服务器之外的存储位置。

## 13. 常见问题

### Request origin is not allowed

浏览器地址与 `CODEY_WEBSITE_ORIGIN` 不一致。

以下地址属于不同 Origin：

```text
http://codey.example.com
https://codey.example.com
https://www.codey.example.com
https://codey.example.com:4321
```

生产环境只保留一个规范域名，并统一使用 HTTPS。

### GitHub 登录后回到本地地址

Market Server 获取到的公开 API 地址错误。检查：

```bash
CODEY_WEBSITE_ORIGIN=https://codey.example.com
```

然后重启服务。

### 暂时无法连接模板市场

检查统一入口和 Market Server：

```bash
sudo systemctl status codey-website
sudo journalctl -u codey-website --since "10 minutes ago"
curl --fail --show-error http://127.0.0.1:4321/.well-known/codey-market.json
```

### 修改环境变量后没有生效

systemd 不会自动重新读取环境文件。执行：

```bash
sudo systemctl restart codey-website
```
