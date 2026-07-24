---
title: Controlled execution & security
description: CodeY capability boundaries and security model — permission modes, sandbox, network broker, and user approval.
---

CodeY's security model rests on one premise: agent work runs in the daemon, not in the UI. Every run is constrained by permission, sandbox, workspace, and network policies together.

## Capability and security boundaries

- Agent work runs in the daemon, not in the UI.
- Run settings combine permission mode, access scope, and tool capability filters.
- Tool-originated HTTP traffic must pass through the daemon-owned network broker.
- Workspace and filesystem adapters reject unsafe path traversal and symlink boundaries.
- MCP servers, skills, plugins, browser automation, and computer control remain subject to daemon policy.
- Sensitive or indeterminate actions can pause for explicit user approval.
- Computer control operates only through the native runtime available for the current platform and its operating-system permissions.

## Run modes

| Mode | Description |
| --- | --- |
| Safe | The most conservative constraint combination, suited for untrusted tasks |
| Standard | The default balance for everyday development |
| Full access | Intentionally removes parts of the OS sandbox — **use only for trusted tasks** |
| Custom | Combine permission, access scope, and tool capability filters as needed |

## Secret handling

- Credential APIs accept secret values only on write; reads return metadata.
- Secret values are resolved only inside the daemon and never enter AgentDefinition, callbacks, events, logs, errors, or diagnostics.
- Production supports the OS credential backend and an explicitly selected owner-only file backend.

## Vulnerability reporting

Report security vulnerabilities through the process in [Support and security policy](/en/docs/support/). Do not disclose exploit details in a public issue.
