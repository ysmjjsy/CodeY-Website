---
title: Agent definitions and sessions
description: Immutable AgentDefinition revisions, provider profiles, run snapshots, sessions, and idempotency semantics.
---

An AgentDefinition is a logical name with immutable revisions. Every update creates a revision. A session pins one definition revision, defaults, component revisions, and event projection version. Existing sessions never follow `latest` after creation.

## Provider profiles and credentials

Before creating a definition, store its provider profile through `client.providers.put()` and its secret through `client.credentials.put()`. A profile contains the public provider, model, base URL, and request defaults. The definition references the returned profile ID and credential ID.

- Profile updates affect only sessions resolved afterward; accepted runs retain their frozen profile and credential generation.
- Deleting a profile prevents new sessions from resolving definitions that reference it but does not rewrite historical snapshots.

## Run snapshots

When a run is accepted, the daemon persists a `ResolvedAgentSnapshotRecord` before execution. It contains effective model options, component hashes, policy intersections, limits, and credential generation references. Secret values are resolved only inside the daemon and never enter snapshots or events.

Run overrides can narrow permissions, tools, and budgets. They cannot widen the runtime, application, or definition ceiling. Updating credentials creates a generation; revocation takes precedence over a pinned generation.

## Session operations

- `query()` atomically creates a session, binds its snapshot, and queues the first input.
- `createSession()` creates an idle session.
- `Session.send()` adds another run.
- Fork creates a new identity and history link without copying active permissions, questions, or runs.

## Idempotency

Idempotency keys are scoped to the application and operation. Repeating identical canonical input returns the original identity. Reusing a key with different input returns `idempotency_conflict`.

## Events

Agent events are semantic projections, not raw TaskStore events. Cursors are opaque strings. Clients load history, continue from the latest applied cursor, deduplicate by event ID, and only produce a result after a terminal event.
