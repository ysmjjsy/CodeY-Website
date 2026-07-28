---
title: 公共 API 覆盖
description: TypeScript、Python 与 Rust 客户端的跨语言 API 覆盖矩阵与有意的边界。
---

TypeScript、Python 和 Rust 使用同一份 `AgentClientRequest` Schema 和同一条守护进程执行路径。高层命名因语言而异，但公共能力集一致。

## 能力矩阵

| 能力 | TypeScript | Python | Rust |
| --- | --- | --- | --- |
| 运行时启动、持久服务、浏览器组件、drain | `RuntimeManager` | `RuntimeManager` | `runtime::RuntimeManager` |
| 定义与校验 | `client.definitions` | `client.definitions` | `AgentClient` |
| 凭据与提供商配置 | `client.credentials`、`client.providers` | `client.credentials`、`client.providers` | `AgentClient` |
| Prompt、MCP、Skill、Plugin 组件 | `client.components` | `client.components` | `AgentClient` |
| 运行时工具目录 | `client.tools` | `client.tools` | `AgentClient` |
| 提供商连接、已配置模型、模型服务路由与任务 | `client.modelServices` | `client.model_services` | `AgentClient` |
| 查询、会话、运行、事件与恢复 | `Agent`、`Session`、`RunHandle` | `Agent`、`Session`、`RunHandle` | `Agent`、`Session`、`RunHandle` |
| 权限与问题处理 | 客户端处理器 | 客户端处理器 | `AgentClient`、`RunHandle` |
| Blob 暂存、文件暂存、有界读取、下载与释放 | `client.blobs` | `client.blobs` | `AgentClient` |
| 发布审阅 | `client.publications`、`Session` | `client.publications`、`Session` | `AgentClient`、`Session` |
| 持久化自动化 | `client.automations` | `client.automations` | `Automations` |
| 附着与持久化扩展 | 回调与扩展 SDK | 回调与扩展 SDK | 回调宿主 |
| 运行时状态、能力与诊断事件 | `AgentClient`、事件 | `AgentClient`、事件 | `AgentClient`、事件 |

所有产生变更的 Blob、发布、模型服务和自动化方法都接受调用方控制的幂等键。传输失败后，用相同的键和负载重试同一操作。

## 有意排除的边界

公共 SDK 有意排除：原始任务事件、流版本、队列修订、队列编辑、Memory 管理、守护进程日志文件和桌面 UI 状态。`Session.send()` 执行持久化输入排队，但不暴露内部队列投影。

Java 目前不是受支持的客户端。Java SDK 必须从同一份公共 Schema 生成，并通过共享一致性测试套件后，才会加入此矩阵。
