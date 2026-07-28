---
title: Public API coverage
description: Cross-language API coverage matrix for TypeScript, Python, and Rust clients, and intentional boundaries.
---

TypeScript, Python, and Rust use the same `AgentClientRequest` schema and daemon execution path. The high-level names differ by language, but the public capability set is the same.

## Capability matrix

| Capability | TypeScript | Python | Rust |
| --- | --- | --- | --- |
| Runtime start, persistent service, browser component, drain | `RuntimeManager` | `RuntimeManager` | `runtime::RuntimeManager` |
| Definitions and validation | `client.definitions` | `client.definitions` | `AgentClient` |
| Credentials and provider profiles | `client.credentials`, `client.providers` | `client.credentials`, `client.providers` | `AgentClient` |
| Prompt, MCP, Skill, and Plugin components | `client.components` | `client.components` | `AgentClient` |
| Runtime tool catalog | `client.tools` | `client.tools` | `AgentClient` |
| Provider connections, configured models, model-service routes and jobs | `client.modelServices` | `client.model_services` | `AgentClient` |
| Query, session, run, events, and recovery | `Agent`, `Session`, `RunHandle` | `Agent`, `Session`, `RunHandle` | `Agent`, `Session`, `RunHandle` |
| Permission and question handling | client handlers | client handlers | `AgentClient`, `RunHandle` |
| Blob stage, file stage, bounded read, download, and release | `client.blobs` | `client.blobs` | `AgentClient` |
| Publication review | `client.publications`, `Session` | `client.publications`, `Session` | `AgentClient`, `Session` |
| Persistent automations | `client.automations` | `client.automations` | `Automations` |
| Attached and durable extensions | callback and extension SDK | callback and extension SDK | callback host |
| Runtime status, capabilities, and diagnostic events | `AgentClient`, events | `AgentClient`, events | `AgentClient`, events |

All mutating blob, publication, model-service, and automation methods accept a caller-controlled idempotency key. Retry the same operation with the same key and payload after transport failure.

## Intentionally excluded boundaries

The public SDK intentionally excludes raw task events, stream versions, queue revisions, queue editing, Memory administration, daemon log files, and Desktop UI state. `Session.send()` performs durable input queuing without exposing the internal queue projection.

Java is not currently a supported client. A Java SDK must be generated from the same public schema and pass the shared conformance suite before it is added to this matrix.
