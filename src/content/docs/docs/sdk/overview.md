---
title: SDK 概览
description: CodeY Agent Runtime SDK 通过本地、语言无关的服务暴露持久化 Agent Harness。
---

CodeY Agent Runtime SDK 将仓库中的持久化 Agent Harness 通过一个本地、语言无关的服务暴露出来。TypeScript、Python 和 Rust 客户端使用同一份 Schema 和同一条守护进程执行路径。

## 可用性

TypeScript 和 Python 包尚未发布到公共包仓库。预发布阶段请使用 `packages/agent-sdk` 和 `sdks/python` 中的源码包，搭配匹配的本地构建运行时。正式发布时，平台运行时产物和 SDK 包将以精确版本成对发布。

- npm 包会选择精确版本的平台运行时包。
- Python 部署可以在 wheel 旁捆绑匹配的运行时，或传入显式校验过的 `runtime_path`。
- 支持 Node.js 24+、Python 3.11+、Rust 1.96+。

## TypeScript 快速开始

设置 `ANTHROPIC_API_KEY`，然后运行完整的 [TypeScript 示例](https://github.com/ysmjjsy/CodeY/blob/main/examples/agent-sdk/typescript/quickstart.ts)。它会：

1. 启动运行时；
2. 存储提供商配置和凭据；
3. 创建不可变的 AgentDefinition 修订；
4. 执行一次查询。

[Python 示例](https://github.com/ysmjjsy/CodeY/blob/main/examples/agent-sdk/python/quickstart.py)使用同一组公共操作。

```ts
import { CodeY } from '@codey/agent-sdk'

await using runtime = await CodeY.start({ applicationId: 'com.example.agent' })

const definition = await runtime.client.definitions.create(spec)
const run = await runtime.client.agent(definition.id).query({
  blocks: [{ type: 'text', text: 'Review this project.' }],
})
console.log(await run.result())
```

`RunHandle.result()` 不需要消费事件迭代器。一个内部事件泵负责游标恢复和去重。

## 边界

这个 SDK 不是远程多租户 API。浏览器应用必须从受信任的后端调用它。`codey-harness-sdk` 仍是独立的内嵌 Rust 组装 API。

## 深入阅读

- [Agent 定义与会话](/docs/sdk/agent-definitions/)
- [运行时与恢复](/docs/sdk/runtime-and-recovery/)
- [扩展、工具与交互](/docs/sdk/extensions/)
- [错误与排查](/docs/sdk/errors/)
- [公共 API 覆盖](/docs/sdk/public-api/)
