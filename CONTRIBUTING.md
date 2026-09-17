# 贡献指南（CodeY 官网）

本仓库是 CodeY 官网与官方文档站点。改动前请先读 [README.md](./README.md) 的「质量门禁」，
以及 [BRAND-TOKENS.md](./BRAND-TOKENS.md) 的品牌 Token 契约。

提交前必须通过：

```sh
pnpm check   # typecheck + astro check + lint + check:styles + test + build
```

CI 在 `pull_request` 和 `main` push 时运行同一组检查。

## CSS 与 `<style>` 块都受检

样式分两处存放，**两处都有门禁**：

| 位置 | 由谁检查 |
|---|---|
| `src/styles/*.css` | `pnpm lint`（Biome 直接解析） |
| 组件内的 `<style>` 块 | `pnpm check:styles` |

Biome **不解析 `.astro` 的 `<style>` 块**——把它写进 `files.includes` 也不会生效。
因此 `scripts/check-astro-styles.mjs` 把每个块提取成临时 `.css`、把 Astro 专有的
`:global(...)` 还原成普通选择器、调用同一份 `biome.json` 规则集，再把行号映射回
`.astro` 源文件。脚本自身的负向测试在 `scripts/check-astro-styles.test.mjs`
（注入违规必须报错、行号必须准确、`:global()` 不得误报），由 `check:styles` 一并运行。

### 关于 `noDescendingSpecificity`

该规则在 `biome.json` 中**显式关闭**。它只在「后写的低特异性选择器可能被先写的高特异性
选择器覆盖」时才有意义，而这要求两者能命中同一元素。本仓库全部 42 处（37 处在
`<style>` 块、5 处在 `src/styles/*.css`）都**经过构建产物实测**：在全部 55 个页面上，
没有任何一对能命中同一元素，即精确率为 0%。为此加 42 条 `biome-ignore` 只会制造噪声。
若将来引入真实冲突，重新开启该规则即可。

> 注意：`biome.json` 里**不能写多行 `//` 注释**——它会让配置解析失败并静默退回默认规则集，
> 表现为规则关闭不生效。该规则的关闭理由因此记录在本文件，而不是配置内联。

## 尺度：什么能 Token 化，什么不能

`tokens.css` 现在覆盖颜色、圆角、间距、**字号**、**层叠顺序**、**动效时长**六类尺度。
另有**断点**一类无法 Token 化，只能靠约定 + 门禁冻结。

| 尺度 | 形式 | 门禁 |
|---|---|---|
| 颜色 / 圆角 / 间距 / 字号 | `--*` Token | CSS 受检（`lint` + `check:styles`） |
| 层叠顺序 | `--z-*`，按**角色**命名 | 同上 |
| 动效时长 | `--duration-*` | 同上 |
| 断点 | 无 Token，见下表 | `check:scales` |

### 字号

只用 `--text-2xs` … `--text-5xl`（11 档，11–32px）。显示级标题用 `clamp()`，
其端点若命中档位则引用 Token。**裸 `rem` 字号会被 `check:font-sizes` 拒绝。**

### 层叠顺序

用角色而非数值：`--z-behind`(-1) < `--z-sticky`(1) < `--z-content`(2) <
`--z-popover`(40) < `--z-header`(50) < `--z-nav-menu`(51) < `--z-toast`(100)。
`--z-nav-menu` 必须高于 `--z-header`，因为展开的菜单要盖住页头自身。

### 动效时长

分两组。**交互反馈**（transition）只用 `--duration-fast/base/slow`（0.15/0.2/0.25s）；
**入场与循环动画**（animation）按动画自身节奏取值，因为那是「被观看的动画」而非
「对操作的应答」。滚动显现用 `--duration-reveal`（0.7s）。

### 断点（无法 Token 化）

CSS 规范不允许 `var()` 出现在媒体查询条件里，因此断点**本质上无法 Token 化**。
`check:scales` 改为冻结允许集合，防止数量继续增长：

| 宽度 | 意图 |
|---|---|
| 420px | 窄手机 |
| 480px | 手机 |
| 520px | 大屏手机 |
| 560px | 手机横屏 |
| 600px | 小phablet |
| 620px | phablet |
| 640px | 大phablet |
| 680px | 小平板 |
| 720px | 平板竖屏 |
| 760px | 平板 |
| 820px | 大平板 |
| 900px | 小笔记本 |
| 920px | 笔记本 |
| 960px | 宽笔记本 |
| 980px | 小桌面 |
| 1050px | 桌面 |
| 1180px | 宽桌面 |

这 17 档是**现状的冻结**，不是推荐设计——全新设计不会选这么多。
但**合并它们属于行为变更而非清理**：把 620 并进 640 会让 621–639px 区间也套用
620 的规则，改变该区间的布局。那需要独立的 before/after 证据，因此本门禁先冻结、
阻止继续增长，把合并留给一个经过论证的决定。新增断点必须同时改
`scripts/check-breakpoints.mjs` 与本表。

### 减少动效

`landing.css`（营销 / 市场 / 商用三布局）与 `starlight.css`（文档站，独立加载）
**都必须**带 `prefers-reduced-motion` 兜底；`check:scales` 会断言两者都在。

## 应该 / 不应该

### 样式

**应该**

- 颜色、间距、圆角、字号、层叠顺序、动效时长一律使用 `src/styles/tokens.css` 中的 Token。
- 间距优先用语义刻度（`--space-sm` 等）；确实落在 4px 档位之间时才用数值刻度（`--space-N`）。
- 字号只用 `--text-*`；响应式标题用 `clamp()`。
- 层叠顺序用 `--z-*`（按角色），不要写数字。
- 圆角只用 `--radius-sm/md/lg/xl/pill`；正圆用 `50%`。
- 新样式写进 `src/styles/` 下的样式表，或在组件 `<style>` 中就近书写。
- 需要提高优先级时用 `@layer` 或选择器特异性（如 `:root:root`）。
- 新增断点前先读上面的断点表——大概率已有合适的一档。

**不应该**

- 不写裸 `px`/`rem` 作为颜色、间距、圆角、字号值（`clamp()` 内的流式边界除外，那不是刻度）。
- 不写裸 `z-index` 数字或裸动效秒数。
- 不使用 `!important`：它让层叠关系不可推理，历史上有 8 处已全部清除。
- 不在组件里硬编码品牌色十六进制值；品牌色只在 Token 层定义一次。
- 不引入第二个 linter/formatter（ESLint、Prettier、Stylelint 都不要）。
- 不新增断点而不更新 `scripts/check-breakpoints.mjs` 与上表。

### 页面与多语言

**应该**

- 新增页面时，中英文两套都要加，并用共享页面壳
  （`ConsolePage` / `CommercialPage` / `MarketPage` / `LandingPage`）承担布局与元信息。
- 页面文件只负责挑选内容组件，并通过 slot 传进去——这样 Astro 才能按路由切分 CSS。
- alternate 链接用 `alternateLocalePath(locale, Astro.url.pathname)` 从当前路径推导。
- 所有用户可见文案走 `src/i18n/` 的 copy 模块，中英文都要提供。

**不应该**

- 不在页面里手写 alternate 路径字面量（`'/en/pricing/'` 这类）——两套页面此前正是这样漂移的。
- 不让共享壳去 import 所有 section 的内容组件：这会把它们的样式表合并进每个页面，
  实测每页 CSS 增加 20–32 KB（详见 `artifacts/design-qa/console-page-shell-2026-09-16/`）。
- 不引入 `[...locale]/` 动态路由段来替代平行目录树（原因同上，且 Starlight 与中间件
  都依赖现有路径结构）。

### 组件

**应该**

- 超过约 400 行的组件按区块拆分，纯函数移入同目录的 `.ts` 模块。
- 拆分时保持导出面不变；需要兼容旧导入路径时用 `export ... from` 重新导出。
- 测试与被测源码同目录，命名为 `*.test.ts`，用 Vitest。
- 视觉类改动产出前后对比证据，放在 `artifacts/design-qa/<主题>-<日期>/`，参照
  [design-qa.md](./design-qa.md) 的格式（源图、实现图、findings、final result）。

**不应该**

- 不在页面/组件里堆积未拆分的巨型文件。
- 不删除或重命名既有导出而不提供兼容层。

### 依赖与生成物

**应该**

- 新增依赖前先确认现有依赖无法解决。
- 提交前确认没有留下一次性的临时脚本。

**不应该**

- 不提交 `dist/`、`node_modules/` 等构建产物。
- 不引入未使用的依赖。

## 跨仓库 Token 同步

品牌 Token 有两个仓库，**以主仓库为权威**：

| 位置 | 角色 |
|---|---|
| `CodeY/apps/desktop/src/shared/styles/global.css` | **权威源**：`--primary` / `--accent` / `--ring` |
| `CodeY-Website/src/styles/tokens.css` | 官网实现，必须与权威源对齐 |
| `CodeY-Website/BRAND-TOKENS.md` | 冻结的跨仓库契约文档 |

当前契约：品牌色 indigo，浅色 `#4f46e5`、深色 `#818cf8`；青色降级为装饰色
（`--decorative*`），不承担品牌语义。

**改品牌色时必须同步两处**：先改主仓库 `global.css`，再改官网 `tokens.css`，
然后更新 `BRAND-TOKENS.md` 并跑两个仓库各自的门禁：

```sh
pnpm -C CodeY check:design-tokens && pnpm -C CodeY/apps/desktop check
pnpm -C CodeY-Website check
```

主仓库的 `check-design-tokens` 会拦截桌面端使用裸调色板类；官网侧靠 Token 层保证一致。
