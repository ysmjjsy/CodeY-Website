---
title: 错误与排查
description: 公共错误模型、常见错误码与离线部署排查指引。
---

公共错误包含稳定的错误码、安全的消息、`retriable` 标志，以及可选的会话 / 运行 / 请求身份。内部 Rust 错误和模型输出不会暴露。

## 常见错误码

| 错误码 | 含义 |
| --- | --- |
| `runtime_not_found` / `runtime_start_failed` | 匹配的产物缺失、无效或启动失败 |
| `runtime_version_mismatch` / `protocol_mismatch` | SDK 和运行时不是精确配对 |
| `authentication_failed` | 本地令牌、应用绑定或连接角色无效 |
| `invalid_agent_definition` | 定义或固定的修订不存在 |
| `idempotency_conflict` | 幂等键被复用但输入不同 |
| `credential_unavailable` | 凭据代次缺失或已吊销 |
| `capability_unsupported` / `capability_disabled` / `capability_not_runnable` | 特性状态因构建、安装或当前上下文而异 |
| `event_cursor_invalid` / `event_cursor_expired` | 重新加载会话快照并从其游标恢复 |
| `callback_timeout` / `callback_unavailable` / `callback_indeterminate` | 附着宿主错过期限、断开连接或留下未知结局 |
| `interaction_unavailable` | 权限或问题处理器不可用 |
| `storage_schema_incompatible` | 运行时无法安全打开此数据目录 |

## 离线部署

将可执行文件、`agent-runtime-manifest.json`、许可证和 SBOM 放在一起，并将可执行文件作为 `runtime_path` 传入。不要在缺少匹配清单的情况下单独复制二进制文件。

## 数据位置

数据位于平台应用数据根目录下，以 `application_id` 为键。运行时端点和连接令牌仅当前用户可读。日志位于该应用的 `logs` 目录，持久化前已脱敏。
