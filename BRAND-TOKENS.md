# 品牌 Token 契约（冻结）

本文件是 `CodeY-Website` 与主仓库 `CodeY/apps/desktop` 之间的**设计 Token 契约**。
改动任一仓库的品牌色、圆角尺度前，必须先改本文件并同步另一侧。

## 权威来源

品牌色的唯一权威是桌面端：

```text
CodeY/apps/desktop/src/shared/styles/global.css
```

官网的 Token 层是 `CodeY-Website/src/styles/tokens.css`，必须与之对齐，
不得各自定义不同的品牌主色。

> **文档修订（2026-09-17）**：本节此前写的是「官网 `landing.css` 与 `starlight.css` 必须与之对齐」。
> Token 已在 2B-1 阶段从 `landing.css` 迁到独立的 `tokens.css`；`landing.css` 现在只有布局与排版
> （146 行，0 个 Token 定义），`starlight.css` 通过 `@import './tokens.css'` 引入。目标文件已更正。

## 命名契约与别名

两侧语义相同的 Token **不要求拼写相同**，契约要求的是「同名可寻址」：
需要改品牌色时，在两个仓库都能用同一个名字找到它。

官网历史拼写是 `--accent*`，全站有数百处引用。为避免无收益的巨大 diff，
官网在 `tokens.css` 中补上契约名，**定义为现有 Token 的别名**——名字统一了，
字面量仍只有一处，改品牌色依然只改 `--accent`：

| 契约名 | 官网别名指向 | 桌面端 |
|---|---|---|
| `--primary` | `var(--accent)` | 字面量 `#4f46e5` / `#818cf8` |
| `--primary-foreground` | `var(--btn-primary-fg)` | 字面量 |
| `--ring` | `var(--accent)` | `var(--primary)` |
| `--accent-decorative` | `var(--decorative-glow)` | **未定义**（见下） |

> **`--accent-decorative` 在桌面端不存在，这是有意的。** 第二轮审计把「计划要求两仓库统一
> 该名字、但两仓库都没实现」记为缺口。复核后确认：桌面端**没有任何装饰色消费者**
> （`global.css` 中 0 处 `radial-gradient`/`linear-gradient`，也无 glow 类 Token），
> 而它的 `--info: #06b6d4` 是**信息语义色**（用于状态图表），不是装饰色。
> 因此正确的做法不是「在桌面端凭空加一个没人用的装饰 Token」，而是：
> 契约名只在**有该语义的一侧**（官网）存在，并在本文件说明原因。

## 品牌色（brand）

| 语义 | 桌面端 Token | 官网 Token | 浅色 | 深色 |
|---|---|---|---|---|
| 品牌主色 | `--primary` | `--accent`（别名 `--primary`） | `#4f46e5` | `#818cf8` |
| 品牌前景 | `--primary-foreground` | `--btn-primary-fg`（别名同上） | `#ffffff` | `#09090b` |
| 焦点环 | `--ring` | `--ring`（别名 → `--accent`） | `#4f46e5` | `#818cf8` |
| 品牌浅底 | `--accent-soft` | `--accent-soft` | 见下 | 见下 |

> **`--accent-soft` 两侧同名但形式不同，替换时不可假设等价。**
> 桌面端是**实色**（浅 `#eef2ff` / 深 `#22243a`）；官网是**半透明叠色**
> （浅 `rgba(79, 70, 229, 0.1)` / 深 `rgba(129, 140, 248, 0.14)`）。
> 本文件此前把桌面端的值填进了官网那一列，已更正。

官网另有两个派生的品牌阶：

| 语义 | 官网 Token | 浅色 | 深色 |
|---|---|---|---|
| 品牌亮阶（用于小字号文本） | `--accent-bright` | `#4338ca` | `#a5b4fc` |
| 品牌辉光 | `--accent-glow` | `rgba(79, 70, 229, 0.12)` | `rgba(129, 140, 248, 0.14)` |

桌面端把 `--accent` / `--accent-foreground` / `--ring` 定义为 `--primary` 的派生别名，
因此 `--primary` 是唯一需要维护的字面量。

## 装饰色（decorative）

青色**不再承担品牌语义**，仅用于氛围装饰（辉光、网格、渐变）：

| 语义 | 官网 Token | 浅色 | 深色 |
|---|---|---|---|
| 装饰辉光 | `--decorative-glow`（契约名 `--accent-decorative`） | `rgba(8, 145, 178, 0.12)` | `rgba(6, 182, 212, 0.16)` |

当前唯一的装饰色消费者是首页与下载页的**氛围辉光**（`.hero-glow-cyan`、
`.download-glow-cyan`）以及 `commercial.css` 的页面径向辉光。
不预设未被消费的 `--decorative` / `--decorative-bright`；确有需要时再新增。

终端面板的提示符前景是另一个独立的深色底场景，用 `--term-accent`
（`#22d3ee`）而不是装饰色或品牌色：终端面板在两种主题下都是深色底
（`--term-bg`），浅色主题若改用更深的青色会失去对比度，所以该 Token
只在深色主题定义一次、浅色主题不覆盖。

判定规则：

- 承载**品牌识别**的按钮、链接、选中态、焦点环 → `--accent*`
- 纯**氛围**的径向辉光、网格线、渐变背景 → `--decorative*`
- 不确定时用 `--accent*`（品牌优先），并在 PR 说明里记录判定理由

> 注意：桌面端 `--info: #06b6d4` 是**信息语义色**，与官网的装饰色无关，不要互相替代。

## 圆角尺度（radius）

官网与桌面端使用同一套尺度：

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | `6px` | 小控件、标签 |
| `--radius-md` | `10px` | 输入框、小卡片 |
| `--radius-lg` | `12px` | 常规卡片、面板 |
| `--radius-xl` | `16px` | 大面板、模态 |

官网历史值 `10/14/20px` 已废弃。

## 间距尺度（space）

间距分两层，都定义在 `src/styles/tokens.css`：

| 层 | 形式 | 用途 |
|---|---|---|
| 数值刻度 | `--space-N` = `Npx`（2px 基准） | 底层真源，覆盖历史上出现过的全部间距 |
| 语义刻度 | `--space-2xs…--space-3xl` | 组件按「紧/松」选间距，不关心像素值 |

语义刻度全部指向上面的数值刻度，改数值刻度即可整体调节节奏：

| Token | 指向 | 值 |
|---|---|---|
| `--space-2xs` | `--space-4` | `4px` |
| `--space-xs` | `--space-8` | `8px` |
| `--space-sm` | `--space-12` | `12px` |
| `--space-md` | `--space-16` | `16px` |
| `--space-lg` | `--space-24` | `24px` |
| `--space-xl` | `--space-32` | `32px` |
| `--space-2xl` | `--space-48` | `48px` |
| `--space-3xl` | `--space-64` | `64px` |

新代码优先用语义刻度；只有落在 4px 档位之间、确实没有对应档位时才用数值刻度。
`gap`/`padding`/`margin` 中的裸 `px` 已清零（`clamp()` 内的流式边界除外，那些不是刻度）。

## 字体

| 语义 | 官网 Token | 值 |
|---|---|---|
| 标题 | `--font-display` | `'Space Grotesk Variable', …` |
| 正文 | `--font-body` | `'PingFang SC', …` |
| 等宽 | `--font-mono` | `'JetBrains Mono Variable', …` |

## 字号尺度（text）

两侧**都有**字号尺度，但**数值不同**，因为场景不同：

| | 桌面端 | 官网 |
|---|---|---|
| 场景 | 高密度 UI 面板 | 阅读型页面（营销页 + 文档） |
| 档位 | 6 个：`--text-nano…--text-reading`（9–15px） | 11 个：`--text-2xs…--text-5xl`（11–32px） |
| 消费方式 | Tailwind 工具类，组件层 0 处裸 `font-size` | `var(--text-*)`，全站 0 处裸 `rem` 字号 |

契约要求的是「两侧都有尺度、都被消费」，而非数值一致。官网的 11 档：

| Token | rem | px |
|---|---|---|
| `--text-2xs` | 0.6875 | 11 |
| `--text-xs` | 0.75 | 12 |
| `--text-sm` | 0.8125 | 13 |
| `--text-base` | 0.875 | 14 |
| `--text-md` | 0.9375 | 15 |
| `--text-lg` | 1 | 16 |
| `--text-xl` | 1.125 | 18 |
| `--text-2xl` | 1.25 | 20 |
| `--text-3xl` | 1.5 | 24 |
| `--text-4xl` | 1.75 | 28 |
| `--text-5xl` | 2 | 32 |

显示级标题（hero / section title）用 `clamp()` 做流体排版，不套用档位；
clamp 的端点若命中档位则引用对应 Token。官网全站裸 `rem` 字号已清零，
由 `scripts/check-font-sizes.mjs` 守卫。

## 变更流程

1. 先改 `CodeY/apps/desktop/src/shared/styles/global.css`（权威侧）。
2. 同步 `CodeY-Website/src/styles/tokens.css`（**唯一**需要改的官网 Token 文件）。
3. 更新本文件。
4. 两个仓库分别提交（它们是独立的 Git 仓库，无法原子提交）。

## 验证

品牌色的**值**由脚本跨仓库校验，不依赖人工核对：

```sh
# 官网：契约名齐备且指向正确、品牌十六进制与桌面端一致、字号无裸 rem
cd CodeY-Website && pnpm check:brand

# 桌面端：无裸调色板类、无任意值
node CodeY/scripts/check-design-tokens.mjs
```

`pnpm check:brand` 会断言：

- 四个契约名（`--primary` / `--primary-foreground` / `--ring` / `--accent-decorative`）
  在官网均已定义；
- 品牌主色的浅色 `#4f46e5`、深色 `#818cf8` 与桌面端 `global.css` 中的值逐字相等；
- `cyan` 未作为品牌色出现在 `landing.css` / `tokens.css` 的品牌 Token 上。
