# CodeY 官网

CodeY 项目官网与官方文档，基于 [Astro](https://astro.build) + [Starlight](https://starlight.astro.build) 构建。

- 首页：自定义深色科技风落地页（`src/pages/index.astro`）
- 文档：Starlight 驱动，内容位于 `src/content/docs/docs/`，与主仓库 `docs/` 保持同步
- 品牌色取自桌面端设计 Token：青色 `#06b6d4`（logo / 深色 accent）、indigo `#4f46e5`（浅色 primary）、琥珀 `#f59e0b`（深色主题点缀）

## 开发

```sh
pnpm install
pnpm dev       # http://localhost:4321
pnpm build     # 产物输出到 dist/
pnpm preview
```

## 结构

| 路径 | 用途 |
| --- | --- |
| `src/pages/index.astro` | 官网首页 |
| `src/components/` | 首页各区块组件 |
| `src/layouts/LandingLayout.astro` | 首页布局与滚动显现脚本 |
| `src/styles/landing.css` | 首页设计 Token 与通用样式 |
| `src/styles/starlight.css` | 文档主题定制 |
| `src/content/docs/docs/` | 中文文档内容 |
| `astro.config.mjs` | Starlight 侧边栏与站点配置 |
