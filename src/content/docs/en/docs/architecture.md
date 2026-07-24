---
title: Architecture
description: CodeY process boundaries, component ownership, execution flow, persistence and recovery semantics, and Rust crate layering.
---

CodeY separates presentation, operating-system integration, durable task execution, and reusable agent capabilities. The daemon is the authority for agent work; the desktop UI only renders state and sends commands.

## System overview

Clients (React desktop UI, TypeScript SDK, Python SDK, Rust client) connect to the daemon through a local protocol:

1. The React desktop UI forwards commands through the Tauri command bridge — Unix socket on Unix platforms, named pipe on Windows.
2. SDK clients in all three languages use the local Agent Runtime protocol directly.
3. The daemon holds the SQLite task store and drives the capability layer through the Harness facade: model providers, tools and execution, MCP / skills / plugins, context / memory / sessions, and subagents / teams / background agents.

The runtime is local, but it is not necessarily offline. Model providers, configured MCP servers, plugins, browser automation, and approved tools may communicate with external services.

## Component ownership

| Component | Owns | Does not own |
| --- | --- | --- |
| React desktop UI | Rendering, navigation, local view state, user input | Task execution, permission policy, recovery, or agent orchestration |
| Tauri shell | Native window integration, configuration access, command forwarding, sidecar lifecycle | Internal agent capability decisions |
| CodeY daemon | Accepted commands, task lifecycle, durable scheduling, permissions, recovery, memory, tools, and orchestration | Product presentation |
| Harness crates | Model, context, execution, sandbox, tool, extension, memory, and agent primitives | Desktop-specific UI behavior |
| Task store | Commands, sessions, events, projections, snapshots, publications, and recovery state | External side-effect guarantees |
| Public SDK clients | Stable application-facing runtime operations | Raw desktop commands or internal daemon task frames |

This boundary prevents UI lifecycle events from becoming execution authority and allows the same runtime to serve non-Tauri applications.

## Desktop command path

1. The user creates or continues a task in the React UI.
2. The Tauri command bridge validates the desktop-facing request and forwards it over local IPC.
3. The daemon accepts the command with an idempotency identity and writes durable task state.
4. The daemon resolves the effective model, permission, sandbox, workspace, and tool configuration.
5. The harness executes the run and emits structured events.
6. Events are persisted before clients project them into conversations, progress, activity, diffs, artifacts, and permission prompts.

The desktop can disconnect or restart without becoming the source of truth for task state.

## Persistence and recovery

The daemon task store uses SQLite in WAL mode. It is the source of truth for accepted commands, sessions, snapshots, events, and recovery state.

After a daemon restart:

- persisted task state is projected again;
- deterministic operations can be replayed;
- scheduled work uses its persisted cursor and misfire policy;
- pending permissions expire or are recovered according to their durable state;
- an external tool call with an unknown outcome becomes `recovery_required`.

External side effects are not exactly-once. Idempotency prevents duplicate command acceptance and gives tool calls stable identities, but it cannot prove the outcome of an external system after a crash.

See [Runtime and recovery](/en/docs/sdk/runtime-and-recovery/) for SDK lifecycle and upgrade semantics.

## Rust crate layers

Dependencies flow downward. Higher layers may compose lower layers; lower layers must not import orchestration or facade layers.

| Layer | Crates | Responsibility |
| --- | --- | --- |
| L0 | `codey-harness-contracts` | Shared types and traits |
| L1 | `journal`, `memory`, `model`, `permission`, `sandbox`, `fs`, `execution`, `budget`, `provider-state` | Independent primitives |
| L2 | `context`, `session`, `tool`, `hook`, `mcp`, `skill`, `tool-search` | Composites and extension mechanisms |
| L3 | `engine`, `subagent`, `team`, `plugin`, `observability`, `agent-runtime` | Orchestration and runtime behavior |
| L4 | `codey-harness-sdk` | Facade used by the daemon and embedded Rust consumers |
| Runtime | `codey-harness-daemon` | Durable task process and local protocol server |

`codey-agent-client` is the separate public Rust client for the local Agent Runtime protocol.

## Protocol sources of truth

Rust protocol types are authoritative.

- Desktop protocol output: `apps/desktop/src/generated/daemon-protocol.ts` and `daemon-protocol.schema.json`
- Public SDK schema: `schemas/agent-sdk/agent-sdk.schema.json`

Regenerate affected files after changing protocol types:

```sh
pnpm generate:daemon-protocol
pnpm generate:agent-sdk-protocol
```

Generated files must not be edited by hand.

## Repository boundaries

| Path | Boundary |
| --- | --- |
| `apps/desktop/src` | React presentation and daemon projections |
| `apps/desktop/src-tauri` | Native desktop shell and daemon bridge |
| `crates/codey-harness-daemon` | Desktop and SDK runtime authority |
| `crates/codey-harness-*` | Reusable harness implementation |
| `packages/agent-sdk` | TypeScript protocol client |
| `sdks/python` | Python protocol client |
| `crates/codey-agent-client` | Rust protocol client and runtime manager |
| `packages/agent-extension-sdk` | TypeScript extension sidecar helpers |
| `sdks/python-extension` | Python extension sidecar helpers |

Architecture rules are summarized in the repository-level `AGENTS.md` files and enforced by scripts under `scripts/`.
