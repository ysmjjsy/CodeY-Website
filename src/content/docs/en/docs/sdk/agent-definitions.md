---
title: Agent definitions and sessions
description: Immutable AgentDefinition revisions, provider profiles, run snapshots, sessions, and idempotency semantics.
---

An AgentDefinition is a logical name with immutable revisions. Every update creates a revision. A session pins one definition revision, a runtime configuration snapshot, component revisions, and an event projection version. Existing sessions never follow `latest` after creation.

## Runtime configuration boundary

Model defaults, permission mode, access mode, tool profile, collaboration switches, and the personalization prompt belong to global runtime configuration. When no execution target is selected, the UI shows “Global runtime” and the daemon uses an invisible internal base Agent to build the plan; there is no user- or project-level default Agent.

An AgentDefinition declares prompts, context, required/optional/denied tool capabilities, MCP servers, skills, plugins, and collaboration constraints. It cannot grant permissions or enable a capability disabled by global runtime configuration.

## Provider profiles and credentials

Before creating a definition, store its provider profile through `client.providers.put()` and its secret through `client.credentials.put()`. A profile contains the public provider, model, base URL, and request defaults. The definition references the returned profile ID and credential ID.

- Profile updates affect only sessions resolved afterward; accepted runs retain their frozen profile and credential generation.
- Deleting a profile prevents new sessions from resolving definitions that reference it but does not rewrite historical snapshots.

## Run snapshots

When a run is accepted, the daemon persists a `ResolvedAgentSnapshotRecord` before execution. It contains effective model options, component hashes, policy intersections, limits, and credential generation references. Secret values are resolved only inside the daemon and never enter snapshots or events.

Run overrides can select a task run mode and narrow tools or budgets. They cannot bypass managed policy, the permission system, the runtime tool profile, or a parent task ceiling. Updating credentials creates a generation; revocation takes precedence over a pinned generation.

## Templates and packages

A Template can produce an Agent, Team, or Workflow and pin Definition and component revisions as dependencies. A `.codeypkg` can carry those dependencies when the target application lacks a skill, MCP server, plugin, or other component. Rendering or installing a template never changes global runtime permissions.

## Session operations

- `query()` atomically creates a session, binds its snapshot, and queues the first input.
- `createSession()` creates an idle session.
- `Session.send()` adds another run.
- Fork creates a new identity and history link without copying active permissions, questions, or runs.

## Idempotency

Idempotency keys are scoped to the application and operation. Repeating identical canonical input returns the original identity. Reusing a key with different input returns `idempotency_conflict`.

## Events

Agent events are semantic projections, not raw TaskStore events. Cursors are opaque strings. Clients load history, continue from the latest applied cursor, deduplicate by event ID, and only produce a result after a terminal event.
