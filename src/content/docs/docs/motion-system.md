---
title: 动画设计系统
description: CodeY 的页面转场、通知、任务状态、控件反馈和状态动画规范。
---

CodeY 的动画用于解释状态、反馈操作和保持空间连续。它不承担装饰任务。所有页面和组件应复用本页的运动 Token、状态模型和实现边界。

本规范借鉴 Apple 的运动设计原则：动画应服务于状态和反馈，支持中断，并在减少动态效果时仍然保持信息可理解。参数是 CodeY 的设计基线，不是 Apple 的内部实现常数。

## 运动原则

- **状态优先**：每个动画都对应一个可解释的状态变化。
- **空间连续**：对象从哪里来，就回到哪里去；相关页面保持来源和去向关系。
- **局部变化**：只动画真正发生变化的部分。
- **快速响应**：用户操作后立即提供反馈。
- **可中断**：拖动、返回和关闭操作可以在动画过程中改变方向或取消。
- **克制循环**：循环动画只表示状态仍在持续，状态结束后立即停止。

## Motion Token

Token 定义在 `src/styles/tokens.css`，页面和组件不得自行创建同义时长或缓动值。

```css
:root {
  --motion-instant: 100ms;
  --motion-fast: 150ms;
  --motion-base: 220ms;
  --motion-page: 480ms;
  --motion-morph: 420ms;
  --motion-notice: 300ms;
  --motion-notice-exit: 200ms;
  --motion-reveal: 700ms;

  --motion-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --motion-ease-spring: cubic-bezier(0.32, 0.72, 0, 1);
  --motion-ease-linear: linear;
  --motion-ease-in-out: ease-in-out;

  --motion-loop-breathe: 1.6s;
  --motion-loop-spinner: 0.8s;
  --motion-loop-cursor: 1s;
}
```

| Token | 用途 |
| --- | --- |
| `100ms` | pressed、颜色变化、图标状态 |
| `150ms` | hover、focus、按钮反馈 |
| `220ms` | 普通展开、淡入、局部替换 |
| `480ms` | 页面转场、任务状态变化 |
| `420ms` | Sheet、Task Island、复杂容器形变 |

循环周期独立于交互时长。它们只用于运行中、等待、流式输出和光标等持续状态。

## 动画分层

CodeY 的动画分为四层。每个动画必须属于其中一层。

| 层级 | 作用 | 参数 |
| --- | --- | --- |
| 微交互层 | 按钮、Tab、hover、focus | `100–150ms` |
| 组件状态层 | 展开、加载、成功、失败 | `180–280ms` |
| 容器转场层 | 页面、Sheet、Task Island | `300–420ms` |
| 环境状态层 | 运行中、等待、流式输出 | `0.8–1.6s` 循环 |

## 页面转场

### 普通页面

普通路由采用同层淡入淡出：旧页面退出时逐渐隐藏，新页面在同一内容表面出现。页面背景保持不透明，避免标题、按钮和表单在切换中重叠。

```text
进入：480ms
退出：400ms
页面位移：0
```

Astro 页面使用 View Transitions。页面级动画只处理 `opacity` 和 `transform`。页面内部的卡片、标题和按钮不重复播放完整入场动画。

### 卡片进入详情

任务卡片、Market 商品卡片、模型卡片和文件列表项进入详情时，应使用共享元素或 FLIP 保持对象身份。

```text
持续时间：380–440ms
起始缩放：0.96–0.98
起始透明度：0.85–1
```

卡片圆角可以连续变为详情页圆角。用户应能看出详情页来自哪个对象。

### Sheet 和弹层

Sheet 从底部升起，背景遮罩降低后层内容的对比度。

```text
进入：420ms
关闭：280–320ms
背景遮罩：透明度 0 → 0.18
```

Sheet 支持拖动。拖动超过自身高度的 `35%`，或释放速度超过 `800px/s` 时完成关闭；否则回到原位。

## 通知

通知分为短结果通知、持续任务状态和页面级状态条。三者不共用同一套动画。

### 短结果通知

用于复制成功、保存成功、删除成功、登录失败和文件上传完成等一次性结果。

```text
进入：300ms
停留：3.5–5s
退出：200ms
位移：8px
缩放：0.98 → 1
```

通知使用唯一事件 ID 去重。同一时间显示一条主通知。成功通知快速消失，错误通知保留解决操作。

### 持续任务状态

运行中、等待权限、网络断开、任务失败和等待恢复等状态绑定在任务上下文中，不自动消失。优先更新任务卡片或 Task Island，而不是重复弹出 toast。

### 页面级状态条

全局连接断开、版本更新、账户状态变化和重新登录提示使用顶部状态条。

```text
进入：280–320ms
退出：220ms
高度：36–44px
```

## Task Island

Task Island 是 CodeY 用来承载任务生命周期的状态容器。当前原型中的 `.dock` 应沿用这一职责。

支持以下状态：

```text
idle → running → streaming → completed
                    ↓
                permission
                    ↓
                 failed
```

| 状态 | 高度 | 内容 |
| --- | ---: | --- |
| `idle` | `44–52px` | 输入框、发送按钮 |
| `running` | `48–56px` | 状态点、任务名、耗时 |
| `streaming` | `56–72px` | 输出摘要、停止按钮 |
| `permission` | `96–132px` | 请求内容、允许、拒绝 |
| `failed` | `88–120px` | 错误原因、重试、详情 |
| `completed` | `52–64px` | 勾选、结果摘要 |

```text
紧凑态 → 展开态：360–420ms
展开态 → 紧凑态：300–360ms
数字更新：180–220ms
完成勾选：320–380ms
```

状态变化应保留已有元素的位置。任务名、状态点和计时器不重新入场；操作按钮从当前容器展开；任务完成后先显示结果，再收回容器。

```css
.task-island {
  overflow: clip;
  border-radius: var(--radius-xl);
  transition:
    height var(--motion-morph) var(--motion-ease-spring),
    border-radius var(--motion-morph) var(--motion-ease-spring);
}

.task-island__details {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--motion-morph) var(--motion-ease-spring),
    opacity var(--motion-base) var(--motion-ease-out);
}

.task-island[data-state="permission"] .task-island__details,
.task-island[data-state="failed"] .task-island__details {
  grid-template-rows: 1fr;
  opacity: 1;
}
```

## 控件反馈

### 按钮

```css
.btn {
  transition:
    transform var(--motion-fast) var(--motion-ease-out),
    background-color var(--motion-base) var(--motion-ease-out),
    border-color var(--motion-base) var(--motion-ease-out),
    box-shadow var(--motion-base) var(--motion-ease-out);
}

.btn:active {
  transform: scale(0.98);
}
```

Hover 和 focus 使用 `150–220ms` 的颜色或边框变化。按下反馈使用 `100–150ms` 和 `0.98` 缩放。控件不使用大幅放大或弹跳。

### 分段控制器和 Tab

```text
选中条移动：280–320ms
文字颜色：150ms
Tab 内容切换：180–220ms
```

选中背景移动，按钮本身不跳动。内容切换只使用 `4px` 的轻微上移和透明度变化。

### 折叠面板

```text
展开：280–360ms
箭头旋转：220ms
内容透明度：0 → 1
```

箭头旋转 `180°`。折叠内容不做整段缩放。

### Tooltip

```text
显示延迟：350–500ms
进入：150ms
位移：4px
```

## 加载、流式输出和状态点

### 加载

```text
0–300ms：不显示指示器
300–1000ms：轻量 skeleton 或 spinner
超过 1s：显示状态文字
超过 3s：显示进度、步骤或耗时
```

加载状态应说明正在发生的事情，例如“正在连接模型”“正在读取文件”“等待权限确认”，而不是只显示旋转图标。

### 流式输出

流式内容按块更新，不逐字播放。

```text
每块：24–48 个字符
或每次更新间隔：80–120ms
新内容进入：180–220ms
位移：4px → 0
```

光标只在流式输出和输入获得焦点时显示，周期为 `1s`。

### 状态点

| 状态 | 动画 |
| --- | --- |
| idle | 静止 |
| running | `1.6s` 外扩光环 |
| waiting | `1.6s` 呼吸 |
| failed | 红色静止 |
| completed | 勾选一次后静止 |

循环动画只代表状态仍然持续。状态结束后立即停止。

## 成功、失败和恢复

### 成功

勾选线条绘制 `320–380ms`，完成后保持静止。只改变图标和状态颜色，不放大整个卡片。

### 失败

错误只做一次轻反馈：

```text
水平位移：0 → 6px → -4px → 0
持续时间：180–220ms
```

之后通过错误边框、错误图标、错误说明、重试按钮和详情链接保持状态。禁止持续抖动。

### 恢复

恢复操作沿用原任务容器：

```text
失败卡片 → 展开恢复操作 → 恢复中 → 原位置回到运行状态
```

不要为同一个任务创建新的视觉对象。

## 列表和内容变化

### 新增

```text
opacity：0 → 1
translateY：6px → 0
持续时间：220ms
```

同一批最多错开三项，每项延迟 `20–24ms`。

### 删除

```text
opacity：1 → 0
height：当前高度 → 0
持续时间：220–280ms
```

后续项目使用 FLIP 移动到新位置，不逐个弹跳。

### 排序和筛选

筛选或排序只更新受影响的内容。旧内容快速移除，新内容从当前位置进入，不重新播放整页入场动画。

## 主题切换和减少动态效果

主题切换只做颜色和阴影过渡：

```text
背景、边框、文字、阴影：220–260ms
```

不旋转、不缩放、不重新加载页面。

在 `prefers-reduced-motion: reduce` 下关闭页面位移、循环光环、shimmer、spinner 和光标闪烁，保留透明度和颜色变化，使状态仍然可理解。

## 实现边界

动画采用以下结构：

```text
业务状态
  ↓
UI 状态机
  ↓
data-state / class
  ↓
CSS、View Transition 或局部 JS 动画
```

建议维护四个基础组件：

- `PageTransition`：路由和页面层级变化。
- `NoticeCenter`：短通知、页面级状态条和去重队列。
- `TaskIsland`：运行、流式输出、权限、失败和完成状态。
- `Motion primitives`：`fade`、`slide`、`scale`、`morph`、`stagger`、`presence`。

业务代码只改变状态，例如 `task.state = "permission"`；动画由状态选择器和统一的 Motion Token 驱动。

性能上优先动画 `transform`、`opacity` 和 `clip-path`。谨慎动画 `width`、`height`、`top`、`left`、`box-shadow` 和 `filter: blur()`。所有状态都必须支持鼠标、键盘、触控和减少动态效果设置。

## 验收标准

- 所有动画能说明对应的状态变化。
- 页面转场、通知和 Task Island 使用统一的时长与缓动。
- 运行结束后所有循环动画停止。
- 任务状态变化不会导致整个页面重排或重复入场。
- 返回、关闭和拖动过程可中断、可取消。
- `prefers-reduced-motion` 下信息和操作仍然可理解。
- 常见交互在正常设备上保持稳定帧率，不依赖大面积 blur 或持续阴影动画。
