# 品牌 Token 契约（冻结）

本文件是 `CodeY-Website` 与主仓库 `CodeY/apps/desktop` 之间的**设计 Token 契约**。
改动任一仓库的品牌色、圆角尺度前，必须先改本文件并同步另一侧。

## 权威来源

品牌色的唯一权威是桌面端：

```text
CodeY/apps/desktop/src/shared/styles/global.css
```

官网 `CodeY-Website/src/styles/landing.css` 与 `src/styles/starlight.css` 必须与之对齐，
不得各自定义不同的品牌主色。

## 品牌色（brand）

| 语义 | 桌面端 Token | 官网 Token | 浅色 | 深色 |
|---|---|---|---|---|
| 品牌主色 | `--primary` | `--accent` | `#4f46e5` | `#818cf8` |
| 品牌前景 | `--primary-foreground` | `--btn-primary-fg` | `#ffffff` | `#09090b` |
| 焦点环 | `--ring` | `--accent-ring` | `#4f46e5` | `#818cf8` |
| 品牌浅底 | `--accent-soft` | `--accent-soft` | `#eef2ff` | `#22243a` |

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
| 装饰辉光 | `--decorative-glow` | `rgba(8, 145, 178, 0.12)` | `rgba(6, 182, 212, 0.16)` |

当前唯一的装饰色消费者是首页与下载页的**氛围辉光**（`.hero-glow-cyan`、
`.download-glow-cyan`）以及 `commercial.css` 的页面径向辉光。
不预设未被消费的 `--decorative` / `--decorative-bright`；确有需要时再新增。

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

## 字体

| 语义 | 官网 Token | 值 |
|---|---|---|
| 标题 | `--font-display` | `'Space Grotesk Variable', …` |
| 正文 | `--font-body` | `'PingFang SC', …` |
| 等宽 | `--font-mono` | `'JetBrains Mono Variable', …` |

## 变更流程

1. 先改 `CodeY/apps/desktop/src/shared/styles/global.css`（权威侧）。
2. 同步 `CodeY-Website/src/styles/landing.css` 与 `starlight.css`。
3. 更新本文件。
4. 视觉类改动必须产出前后对比证据，见
   `CodeY-Website/artifacts/design-qa/` 下的 `design-qa.md`。
5. 两个仓库分别提交（它们是独立的 Git 仓库，无法原子提交）。

## 验证

```sh
# 桌面端：无裸调色板类、无任意值
node CodeY/scripts/check-design-tokens.mjs

# 官网：Token 已对齐（应命中 indigo，不应命中作为品牌色的 cyan）
grep -n "818cf8\|4f46e5" CodeY-Website/src/styles/landing.css
```
