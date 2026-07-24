---
title: Extensions, tools, and interactions
description: Attached callbacks, durable extension sidecars, permission and question handling, and credential boundaries.
---

## Attached callbacks

Attached callbacks use a dedicated authenticated duplex connection. Tool and Hook registrations declare scope, JSON schemas, timeout, result budget, concurrency, risk, and idempotency. The daemon owns authorization, schema validation, lease expiry, cancellation, output redaction, and durable invocation state.

- Client, session, and run scopes are exact. Two active hosts cannot claim the same tool scope.
- Pre-tool and result-changing Hooks must be fail-closed and declare `mayChangeResult`.
- Hook responses may deny or narrow work; they cannot grant a permission.

## Durable extension sidecars

Attached callbacks are available only while the host process and heartbeat are alive. They are invalid for automations and detached agents. Use `@codey/agent-extension-sdk` or `codey-agent-extension-sdk` for durable Node/Python sidecars.

Installed sidecars are copied into daemon-owned content-addressed storage, hashed, trusted, and sandboxed before use.

## Permissions and question handling

Permissions and AskUserQuestion requests arrive as AgentEvents. A configured handler resolves the request through the same durable broker revision. Missing handlers follow the definition interaction fallback — **missing never implies approval**.

## Credential boundaries

- Credential APIs accept secret values only on write; reads return metadata.
- Production supports the OS credential backend and an explicitly selected owner-only file backend.
- Secrets are excluded from AgentDefinition, callbacks, events, logs, errors, and diagnostics.

## Trust model

All callback input must be treated as untrusted. A callback does not inherit direct access to daemon storage or credentials. Networked tools remain subject to the network broker and workspace policy.
