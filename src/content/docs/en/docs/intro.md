---
title: What is CodeY
description: CodeY is an AI work partner that helps you complete tasks and deliver results.
---

CodeY is an AI work partner that helps you complete tasks and deliver results. Give it a goal, files, links, or project context; CodeY uses the capabilities currently available within your approval boundaries to advance the task, verify the work, and clearly deliver the result.

CodeY uses a local-first execution model. Tasks run durably in a local daemon, permissions are explicit, and the same runtime serves both the desktop app and your applications through the SDK.

:::caution[Development stage]
CodeY is in active `0.4.x` development. Installers and release notes are published through [GitHub Releases](https://github.com/ysmjjsy/CodeY-Releases/releases). Expect interfaces and storage formats to change before a stable release.
:::

## Two entry points

- **CodeY Desktop** — a project-oriented workspace for starting, inspecting, and managing tasks with CodeY.
- **CodeY Agent Runtime** — the same durable Agent Harness exposed to TypeScript, Python, and Rust applications through a language-neutral local protocol.

The React UI never executes agent work. It sends commands through Tauri to a local daemon. Task execution, recovery, scheduling, permissions, memory, tools, and agent orchestration are all owned by the daemon.

## Highlights

| Capability | Description |
| --- | --- |
| Durable tasks | Task state and events are journaled so the UI can reconnect and the daemon can recover work after a restart |
| Inspectable workbench | Review plans, progress, commands, file changes, artifacts, permission decisions, and Agent Team attempt history in one task timeline |
| Controlled execution | Safe, standard, full-access, or custom run settings backed by permission, sandbox, workspace, and network policies |
| Extensible capabilities | Built-in tools, MCP servers, skills, plugins, browser automation, and authorized computer control |
| Agent orchestration | Subagents, agent teams, background agents, and persistent scheduled tasks; teams run by explicit dependency and clean up old execution before retry |
| Local runtime SDK | TypeScript, Python, and Rust applications reuse the same runtime without depending on Tauri |
| Cross-platform desktop | Release configuration covers macOS, Windows, and Linux; native computer-control support is platform-specific |
| Bilingual interface | English and Simplified Chinese are included, with light, dark, and system themes |

## Next steps

- [Getting started](/en/docs/getting-started/) — download an installer or run CodeY from source
- [Architecture](/en/docs/architecture/) — understand daemon, task store, and Harness ownership
- [Agent Runtime SDK](/en/docs/sdk/overview/) — reuse the same runtime in your applications
