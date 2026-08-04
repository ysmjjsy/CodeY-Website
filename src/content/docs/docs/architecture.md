---
title: 架构
description: CodeY 的进程边界、组件职责、执行流程、持久化恢复语义与 Rust crate 分层。
---

CodeY 分离了呈现、操作系统集成、持久化任务执行和可复用 Agent 能力。守护进程是 Agent 工作的权威；桌面 UI 只渲染状态和发送命令。

## 系统概览

客户端（React 桌面 UI、TypeScript SDK、Python SDK、Rust 客户端）通过本地协议连接守护进程：

1. React 桌面 UI 经 Tauri 命令桥转发命令，Unix 平台走 Unix Socket，Windows 走命名管道。
2. 三种语言的 SDK 直接使用本地 Agent Runtime 协议。
3. 守护进程持有 SQLite 任务存储，并通过 Harness Facade 驱动能力层：模型提供商、工具与执行、MCP / Skill / Plugin、上下文 / 记忆 / 会话、子 Agent / 团队 / 后台 Agent。

运行时是本地的，但不一定离线。模型提供商、已配置的 MCP Server、Plugin、浏览器自动化和经过批准的工具可能与外部服务通信。

## 组件职责

| 组件 | 拥有 | 不拥有 |
| --- | --- | --- |
| React 桌面 UI | 渲染、导航、本地视图状态、用户输入 | 任务执行、权限策略、恢复、Agent 编排 |
| Tauri 壳 | 原生窗口集成、配置访问、命令转发、sidecar 生命周期 | 内部 Agent 能力决策 |
| CodeY 守护进程 | 已接收命令、任务生命周期、持久调度、权限、恢复、记忆、工具、编排 | 产品呈现 |
| Harness crates | 模型、上下文、执行、沙箱、工具、扩展、记忆和 Agent 原语 | 桌面特有的 UI 行为 |
| 任务存储 | 命令、会话、事件、投影、快照、发布和恢复状态 | 外部副作用保证 |
| 公共 SDK 客户端 | 面向应用的稳定运行时操作 | 原始桌面命令或守护进程内部任务帧 |

这一边界防止 UI 生命周期事件成为执行权威，并允许同一运行时服务非 Tauri 应用。

## 桌面命令路径

1. 用户在 React UI 中创建或继续一个任务。
2. Tauri 命令桥校验面向桌面的请求，通过本地 IPC 转发。
3. 守护进程以幂等标识接收命令，写入持久化任务状态。
4. 守护进程解析生效的模型、权限、沙箱、工作区和工具配置。
5. Harness 执行运行并发出结构化事件。
6. 事件先持久化，客户端再将其投影为会话、进度、活动、差异、产物和权限提示。

桌面端可以断开或重启，它从不是任务状态的事实来源。

## 持久化与恢复

守护进程任务存储使用 WAL 模式的 SQLite。它是已接收命令、会话、快照、事件和恢复状态的事实来源。

守护进程重启后：

- 持久化的任务状态被重新投影；
- 确定性操作可以重放；
- 定时工作使用其持久化游标和 misfire 策略；
- 待定权限按其持久化状态过期或恢复；
- 结局未知的外部工具调用进入 `recovery_required` 状态。

外部副作用不是 exactly-once。幂等避免重复接收命令，并给工具调用稳定身份，但它无法证明崩溃后外部系统的实际结局。

提交前发现的工作区文件或命令版本冲突属于可重试拒绝，副作用结果固定为未发生，不会进入 `recovery_required`。

## Agent Team 执行语义

Agent Team 成员共享当前实时工作区。读取、测试或审查另一成员写入的文件，以及可能写入同一路径的任务，必须通过显式依赖串行；真正独立的任务才能并行。

Team 以持久化 attempt 作为调度和恢复边界。`wait` 只响应任务、attempt、成员、阻塞、输入请求、产物或终态变化；token、费用和心跳更新不会消耗父 Agent 的迭代窗口。fail-fast 会实际停止同组未结束的子执行，retry 会先确认旧执行结束，再创建新 attempt。迭代或预算耗尽记录为 `Budget` 失败，而不是任务完成。

桌面工作台会展示每次 attempt 的状态、失败分类和原始错误，便于定位失败与重试过程。

SDK 的生命周期和升级语义见[运行时与恢复](/docs/sdk/runtime-and-recovery/)。

## Rust crate 分层

依赖只向下流动。高层可以组合低层；低层不得引入编排层或门面层。

| 层级 | Crates | 职责 |
| --- | --- | --- |
| L0 | `codey-harness-contracts` | 共享类型与 trait |
| L1 | `journal`、`memory`、`model`、`permission`、`sandbox`、`fs`、`execution`、`budget`、`provider-state` | 相互独立的原语 |
| L2 | `context`、`session`、`tool`、`hook`、`mcp`、`skill`、`tool-search` | 组合体与扩展机制 |
| L3 | `engine`、`subagent`、`team`、`plugin`、`observability`、`agent-runtime` | 编排与运行时行为 |
| L4 | `codey-harness-sdk` | 守护进程和内嵌 Rust 消费方使用的门面 |
| Runtime | `codey-harness-daemon` | 持久任务进程与本地协议服务 |

`codey-agent-client` 是独立的公共 Rust 客户端，实现本地 Agent Runtime 协议。

## 协议事实来源

Rust 协议类型是权威。

- 桌面协议产物：`apps/desktop/src/generated/daemon-protocol.ts` 与 `daemon-protocol.schema.json`
- 公共 SDK Schema：`schemas/agent-sdk/agent-sdk.schema.json`

修改协议类型后重新生成受影响的文件：

```sh
pnpm generate:daemon-protocol
pnpm generate:agent-sdk-protocol
```

生成的文件不得手工编辑。

## 仓库边界

| 路径 | 边界 |
| --- | --- |
| `apps/desktop/src` | React 呈现与守护进程投影 |
| `apps/desktop/src-tauri` | 原生桌面壳与守护进程桥 |
| `crates/codey-harness-daemon` | 桌面与 SDK 的运行时权威 |
| `crates/codey-harness-*` | 可复用的 Harness 实现 |
| `packages/agent-sdk` | TypeScript 协议客户端 |
| `sdks/python` | Python 协议客户端 |
| `crates/codey-agent-client` | Rust 协议客户端与运行时管理器 |
| `packages/agent-extension-sdk` | TypeScript 扩展 sidecar 工具 |
| `sdks/python-extension` | Python 扩展 sidecar 工具 |

架构规则汇总在仓库各级 `AGENTS.md` 中，并由 `scripts/` 下的脚本强制执行。
