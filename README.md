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

默认要求 CodeY 主仓库位于官网仓库同级目录 `../CodeY`。如果目录不同，可设置
`CODEY_REPOSITORY`。运行数据默认保存在官网仓库的 `.codey-market/`。

账号支持用户名或邮箱加密码，以及 GitHub OAuth。GitHub 登录需要在服务端配置：

```sh
CODEY_MARKET_GITHUB_CLIENT_ID=...
CODEY_MARKET_GITHUB_CLIENT_SECRET=...
CODEY_MARKET_ADMIN_GITHUB_LOGINS=github-login-1,github-login-2
```

本地开发可复制 `.env.example` 为 `.env.local`。`pnpm dev` 和 `pnpm start`
会自动加载该文件，进程中已有的环境变量优先。`.env.local` 已被 Git 忽略，
不得提交 GitHub Client Secret。

OAuth App 的回调地址为
`<官网地址>/api/market/v1/auth/github/callback`。这些变量只传给 Market Server，不会进入前端构建产物。

登录后可从账号菜单进入 `/market/dashboard/` 管理自己的模板。配置在
`CODEY_MARKET_ADMIN_GITHUB_LOGINS` 中的 GitHub 账号会显示模板审核菜单。

## 结构

| 路径 | 用途 |
| --- | --- |
| `src/pages/index.astro` | 官网首页 |
| `src/pages/market/dashboard.astro` | 用户模板管理与管理员审核后台 |
| `src/components/` | 首页各区块组件 |
| `src/layouts/LandingLayout.astro` | 首页布局与滚动显现脚本 |
| `src/styles/landing.css` | 首页设计 Token 与通用样式 |
| `src/styles/starlight.css` | 文档主题定制 |
| `src/content/docs/docs/` | 中文文档内容 |
| `astro.config.mjs` | Starlight 侧边栏与站点配置 |
