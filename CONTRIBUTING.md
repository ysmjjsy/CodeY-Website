# 贡献指南（CodeY 官网）

本仓库是 CodeY 官网与官方文档站点。改动前请先读 [README.md](./README.md) 的「质量门禁」，
以及 [BRAND-TOKENS.md](./BRAND-TOKENS.md) 的品牌 Token 契约。

提交前必须通过：

```sh
pnpm check   # typecheck + astro check + lint + test + build
```

CI 在 `pull_request` 和 `main` push 时运行同一组检查。

## 应该 / 不应该

### 样式

**应该**

- 颜色、间距、圆角、字体一律使用 `src/styles/tokens.css` 中的 Token。
- 间距优先用语义刻度（`--space-sm` 等）；确实落在 4px 档位之间时才用数值刻度（`--space-N`）。
- 圆角只用 `--radius-sm/md/lg/xl/pill`；正圆用 `50%`。
- 新样式写进 `src/styles/` 下的样式表，或在组件 `<style>` 中就近书写。
- 需要提高优先级时用 `@layer` 或选择器特异性（如 `:root:root`）。

**不应该**

- 不写裸 `px`/`rem` 作为间距或圆角值（`clamp()` 内的流式边界除外，那不是刻度）。
- 不使用 `!important`：它让层叠关系不可推理，历史上有 8 处已全部清除。
- 不在组件里硬编码品牌色十六进制值；品牌色只在 Token 层定义一次。
- 不引入第二个 linter/formatter（ESLint、Prettier、Stylelint 都不要）。

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
