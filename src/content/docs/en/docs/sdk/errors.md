---
title: Errors and troubleshooting
description: Public error model, common error codes, and offline deployment troubleshooting.
---

Public errors contain a stable code, safe message, `retriable` flag, and optional session, run, or request identity. Internal Rust errors and model output are not exposed.

## Common error codes

| Code | Meaning |
| --- | --- |
| `runtime_not_found` / `runtime_start_failed` | Matching artifact is absent, invalid, or failed to start |
| `runtime_version_mismatch` / `protocol_mismatch` | SDK and runtime are not an exact pair |
| `authentication_failed` | Local token, application binding, or connection role is invalid |
| `invalid_agent_definition` | Definition or pinned revision does not exist |
| `idempotency_conflict` | A key was reused with different canonical input |
| `credential_unavailable` | Credential generation is missing or revoked |
| `capability_unsupported` / `capability_disabled` / `capability_not_runnable` | Feature state differs by build, installation, or current context |
| `event_cursor_invalid` / `event_cursor_expired` | Reload the session snapshot and resume from its cursor |
| `callback_timeout` / `callback_unavailable` / `callback_indeterminate` | Attached host missed its deadline, disconnected, or left an unknown outcome |
| `interaction_unavailable` | Permission or question handler is not available |
| `storage_schema_incompatible` | Runtime cannot safely open this data directory |

## Offline deployment

Place the executable, `agent-runtime-manifest.json`, licenses, and SBOM together and pass the executable as `runtime_path`. Do not copy a binary without its matching manifest.

## Data locations

Data is under the platform application-data root keyed by `application_id`. Runtime endpoints and connection tokens are user-only. Logs are in that application's `logs` directory and are redacted before persistence.
