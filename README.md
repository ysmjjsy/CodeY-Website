# CodeY 官网

CodeY 项目官网与官方文档，基于 [Astro](https://astro.build) + [Starlight](https://starlight.astro.build) 构建。

- 首页：自定义深色科技风落地页（`src/pages/index.astro`）
- 文档：Starlight 驱动，内容位于 `src/content/docs/docs/`，与主仓库 `docs/` 保持同步
- 品牌色取自桌面端设计 Token：青色 `#06b6d4`（logo / 深色 accent）、indigo `#4f46e5`（浅色 primary）、琥珀 `#f59e0b`（深色主题点缀）

## 开发

```sh
pnpm install
pnpm dev       # 同时启动官网和 Market API，http://127.0.0.1:4321
pnpm build     # 构建官网和 Market Server
pnpm start     # 同源提供官网、Market API 和 discovery
```

## 模板市场运行方式

模板市场页面位于 `/market/` 和 `/en/market/`。浏览器始终请求同源地址：

```text
/api/market/v1
/.well-known/codey-market.json
```

`pnpm dev` 会先启动 Market Server，再启动 Astro，并由 Astro 代理这两个路径。
`pnpm start` 会启动 Market Server 和统一的生产 HTTP 入口。前端不需要配置
`PUBLIC_MARKET_API_URL`。

模板市场后端位于本仓库的 `server/market-server`，包含独立的 `.codeypkg` v1 读取与校验实现，
不依赖 CodeY 桌面端仓库或外部格式仓库。运行数据默认保存在官网仓库的 `.codey-market/`，
账号、会话、市场和 Cloud 业务数据存放在 PostgreSQL。

账号支持用户名或邮箱加密码，以及 GitHub OAuth。GitHub 登录需要在服务端配置：

```sh
CODEY_MARKET_GITHUB_CLIENT_ID=...
CODEY_MARKET_GITHUB_CLIENT_SECRET=...
CODEY_MARKET_ADMIN_GITHUB_LOGINS=github-login-1,github-login-2
CODEY_MARKET_ADMIN_USERNAME=admin
CODEY_MARKET_ADMIN_PASSWORD=change-me
CODEY_DATABASE_URL=postgresql://goya:change-me@39.105.2.5:15432/codey
```

本地管理员会在服务启动时自动创建。修改账号或密码配置后，重启服务即可生效。

本地开发可复制 `.env.example` 为 `.env.local`。`pnpm dev` 和 `pnpm start`
会自动加载该文件，进程中已有的环境变量优先。`.env.local` 已被 Git 忽略，
不得提交数据库密码、管理员密码或 GitHub Client Secret。

OAuth App 的回调地址为
`<官网地址>/api/market/v1/auth/github/callback`。这些变量只传给 Market Server，不会进入前端构建产物。

登录后可从账号菜单进入 `/console/`。普通用户可以管理套餐、积分和自己的模板；
配置在 `CODEY_MARKET_ADMIN_GITHUB_LOGINS` 中的 GitHub 账号还可以审核模板并管理模型与套餐。

## 云账号、套餐与官方模型

官网账号同时用于模板市场、套餐购买和 Desktop 登录。用户与管理员功能统一位于
`/console/`。Desktop 通过系统浏览器执行 OAuth 2.0 Authorization
Code + PKCE 登录，并从 `/.well-known/codey-cloud.json` 发现 Cloud API。

管理员可以在云管理端：

- 配置 OpenAI-compatible、Anthropic 或 Gemini 上游。API Key 使用
  `CODEY_CLOUD_SECRET_KEY` 加密后只保存在服务端。
- 发布 CodeY 官方模型、模型积分价格和套餐可用模型。
- 发布版本化套餐及积分包，并为同一商品配置微信、支付宝、Stripe 等多条报价。

用户同一时间只有一个有效套餐。付费周期从生效时刻起计算一个自然月，并保留账单
锚点日。套餐积分随周期到期，积分包永久有效；扣减按最早到期优先。提前续费从当前
周期结束后生效。升级按剩余周期补差并立即生效。降级只保存下期选择，仍需用户主动
购买下一周期。

CodeY 官方模型请求经过 `/api/cloud/v1/gateway/`。上游密钥不会返回浏览器或
Desktop。Desktop 中用户自己的 API Key 和本地模型仍走本地 daemon，不进入云积分
账本。Desktop 从 `/api/cloud/v1/entitlements/models` 获取按账号、套餐和目录版本绑定的
Ed25519 签名模型目录，并使用 discovery 中的公钥校验后同步 CodeY 官方模型。

### 服务端配置

复制 `.env.example` 到 `.env.local`。至少设置：

```sh
# 生成方式示例：openssl rand -base64 32
CODEY_CLOUD_SECRET_KEY=...
CODEY_CLOUD_DEFAULT_TIMEZONE=Asia/Shanghai
```

模型 entitlement 签名密钥默认生成到
`CODEY_MARKET_DATA_ROOT/cloud-entitlement-ed25519.pk8`。生产部署必须持久化并备份该文件。
也可以通过 `CODEY_CLOUD_ENTITLEMENT_SIGNING_KEY` 提供 unpadded base64url 编码的 Ed25519
PKCS#8 私钥，并用 `CODEY_CLOUD_ENTITLEMENT_KEY_ID` 设置稳定的密钥 ID。

支付渠道按组启用。某组只填写一部分变量时服务会拒绝启动。微信和支付宝私钥、公钥
文件必须只对服务账号可读。Stripe webhook、微信通知和支付宝异步通知地址都应指向
公开 HTTPS 官网。`CODEY_CLOUD_ENABLE_TEST_PAYMENTS` 只用于本地集成测试，生产环境
必须保持 `false`。

服务启动时会在 `CODEY_DATABASE_URL` 指向的 PostgreSQL 数据库中幂等创建表和索引。
`.codey-market/` 只保存待审核和已发布的模板文件。部署时应同时备份 PostgreSQL 和该目录。

支付代码包含下单、签名校验、金额/币种/商户身份核对、重复回调幂等处理。真实支付
仍需使用各商户 sandbox 和生产凭据分别验收，尤其是回调可达性、证书轮换和账单对账。

## 结构

| 路径 | 用途 |
| --- | --- |
| `src/pages/index.astro` | 官网首页 |
| `src/pages/console/` | 套餐、模板、审核和模型管理控制台 |
| `src/components/` | 首页各区块组件 |
| `src/layouts/LandingLayout.astro` | 首页布局与滚动显现脚本 |
| `src/styles/landing.css` | 首页设计 Token 与通用样式 |
| `src/styles/starlight.css` | 文档主题定制 |
| `src/content/docs/docs/` | 中文文档内容 |
| `astro.config.mjs` | Starlight 侧边栏与站点配置 |
| `server/market-server` | 官网账号、模板市场、Cloud 商业域、支付和模型网关后端 |
