---
title: Runtime and recovery
description: Runtime lifecycle, persistent service, scheduled automations, crash recovery, and side-by-side upgrade semantics.
---

## Application isolation

Each `application_id` maps to isolated data, configuration, component, log, token, and local endpoint paths. The ID must remain stable across releases. SDK and runtime versions are exact pairs; manifest target, size, SHA-256, storage range, and feature graph are checked before spawn.

Release artifacts are signed. Set `CODEY_RUNTIME_TRUSTED_PUBLIC_KEY` to a PEM public key for offline or enterprise artifacts so verification is pinned to your distribution authority. Package-manager integrity protects official platform packages; an explicit `runtime_path` must always be accompanied by its manifest and signature.

## Attached mode and persistent mode

**Attached mode** starts a child runtime when no compatible instance is reachable. The daemon remains alive while clients, runs, browser processes, callbacks, or scheduler obligations hold activity leases. It may exit after the idle timeout.

**Persistent mode** is explicit. `RuntimeManager.persistentService()` / `persistent_service()` installs a versioned user unit through launchd, systemd user services, or Windows Task Scheduler. The service owns logs, restarts failed runtime processes, and disables idle exit. Installation, status, start, stop, and uninstall are separate operations.

## Scheduled automations

Automations require persistent mode. They pin an AgentDefinition revision, timezone, interval, and misfire policy:

- `run_once` emits at most one catch-up run;
- `skip` advances the durable cursor.

Definitions that require attached callbacks are rejected because the host process may be absent.

## Crash recovery

TaskStore is the source of truth for accepted commands, sessions, snapshots, events, and recovery state. A daemon crash can replay deterministic operations. External side effects are not exactly-once: tool invocations carry idempotency identities; an unknown external outcome becomes `recovery_required` and must be resolved explicitly.

## Side-by-side upgrades

Runtime upgrades are side-by-side: stop and drain the old service, install the matching new artifact, then start it. An older runtime cannot open data outside its declared storage schema range.

Drain rejects new runs and waits for active work, callback invocations, browser processes, and scheduler obligations to release their activity leases. Upgrade must stop if blockers remain; it cannot replace an in-use runtime directory.

## Browser component

The optional browser component is separate from the base runtime. Its manifest pins runtime range, platform, Node version, Chrome build, and hashes:

- `disabled` — never resolves it;
- `optional` — reports an unavailable capability when absent;
- `required` — fails startup when validation fails.
