---
title: 参与贡献
description: 通过 GitHub Issue 与 Pull Request 参与 CodeY 开发的流程与约定。
---

欢迎通过 GitHub Issue 和 Pull Request 参与贡献。参与即表示你同意遵守[行为准则](https://github.com/ysmjjsy/CodeY/blob/main/CODE_OF_CONDUCT.md)。

## 开始之前

- 先搜索既有 Issue 和 Pull Request，避免重复。
- 用 Issue 描述可复现的 Bug 或聚焦的功能请求。
- 大范围架构变更先讨论再实现。
- 安全漏洞通过[安全策略](/docs/support/#安全策略)的流程报告，不要提交普通公开 Issue。

非平凡功能需要在 `docs/plans/` 下留两份记录：

1. `YYYY-MM-DD-<topic>-design.md`
2. `YYYY-MM-DD-<topic>-implementation.md`

结构参照既有记录，实现步骤要可验证。

## 开发环境

工具链要求见[快速开始](/docs/getting-started/#环境要求)。修改进程边界或公共协议前，先阅读[架构](/docs/architecture/)。

## 变更约定

保持变更聚焦。没有当前需求时，不要添加抽象、配置或兼容路径。

### 前端

- 功能代码放在 `apps/desktop/src/features/<domain>`，共享原语放在 `apps/desktop/src/shared`。
- 客户端状态用 Zustand，守护进程状态用 TanStack Query，表单用 React Hook Form + Zod。
- 每个用户可见字符串都要有英文和简体中文两份 i18next 资源。
- 使用项目设计 Token；裸的 Tailwind 调色板类会被策略检查拒绝。
- 只用 Biome，不添加 ESLint 或 Prettier 配置。
- Vitest 测试和 Storybook stories 与组件放在一起。

### Rust

- 保持[架构文档](/docs/architecture/#rust-crate-分层)中的 crate 依赖分层。
- 整个工作区禁止 `unsafe`。
- 共享依赖版本声明在根 `Cargo.toml`。
- 工具 HTTP 流量走 `codey-harness-tool/src/network_broker.rs`。
- 编排、权限、沙箱和授权路径不允许生产环境的 Mock、Stub 或占位实现。

### 生成的协议文件

以下文件不得手工编辑，修改协议类型后运行对应的生成和检查命令，并把源码变更和生成产物一起提交：

- `apps/desktop/src/generated/daemon-protocol.ts` 与 `daemon-protocol.schema.json`
- `apps/desktop/src/routeTree.gen.ts`
- `schemas/agent-sdk/agent-sdk.schema.json`

## 校验

开发时运行最小相关检查，请求评审前运行：

```sh
pnpm check:quick
```

变更跨多个子系统或影响发布路径时，用 `pnpm check` 做 CI 级校验。

## 提交与 Pull Request

使用 Conventional Commits，主题用祈使语气英文：

```text
feat: add scheduled task filtering
fix: recover interrupted permission state
docs: clarify runtime installation
```

一个 Pull Request 应当：说明问题和所选方案；不夹带无关清理；链接相关 Issue 或设计记录；列出实际运行过的检查；可见的 UI 变更附截图；行为变更附测试；行为、配置或 API 变化时更新公开文档；不提交密钥、构建产物或本地环境文件。

贡献即表示你同意你的贡献以 [Apache License 2.0](https://github.com/ysmjjsy/CodeY/blob/main/LICENSE) 授权。
