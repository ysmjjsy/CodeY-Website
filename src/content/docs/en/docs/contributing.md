---
title: Contributing
description: How to participate in CodeY development through GitHub issues and pull requests.
---

Contributions are welcome through GitHub issues and pull requests. By participating, you agree to follow the [Code of Conduct](https://github.com/ysmjjsy/CodeY/blob/main/CODE_OF_CONDUCT.md).

## Before starting

- Search existing issues and pull requests before opening a duplicate.
- Use a GitHub issue to describe a reproducible bug or a focused feature request.
- Discuss broad architecture changes before implementing them.
- Report vulnerabilities through the [security policy](/en/docs/support/#security-policy) process, not a normal public issue.

Non-trivial features require two records under `docs/plans/`:

1. `YYYY-MM-DD-<topic>-design.md`
2. `YYYY-MM-DD-<topic>-implementation.md`

Match the structure of existing records and make implementation steps verifiable.

## Development setup

See [Getting started](/en/docs/getting-started/#prerequisites) for toolchain requirements. Read [Architecture](/en/docs/architecture/) before changing a process boundary or public protocol.

## Change conventions

Keep changes focused. Do not add abstractions, configuration, or compatibility paths without a current requirement.

### Frontend

- Put feature code under `apps/desktop/src/features/<domain>`; put shared primitives under `apps/desktop/src/shared`.
- Use Zustand for client state, TanStack Query for daemon state, and React Hook Form with Zod for forms.
- Put every user-visible string in both English and Simplified Chinese i18next resources.
- Use project design tokens. Raw Tailwind palette classes fail policy checks.
- Use Biome only; do not add ESLint or Prettier configuration.
- Colocate Vitest tests and Storybook stories with the component.

### Rust

- Preserve the crate dependency layers documented in [Architecture](/en/docs/architecture/#rust-crate-layers).
- `unsafe` is forbidden across the workspace.
- Declare shared dependency versions in the root `Cargo.toml`.
- Send tool HTTP traffic through `codey-harness-tool/src/network_broker.rs`.
- Do not add production mocks, stubs, or placeholder implementations in orchestration, permission, sandbox, or authorization paths.

### Generated protocol files

Do not edit these files by hand. After changing protocol types, run the corresponding generation and check commands, and commit the source change and generated output together:

- `apps/desktop/src/generated/daemon-protocol.ts` and `daemon-protocol.schema.json`
- `apps/desktop/src/routeTree.gen.ts`
- `schemas/agent-sdk/agent-sdk.schema.json`

## Verification

Run the narrowest relevant checks while developing. Before requesting review, run:

```sh
pnpm check:quick
```

Use `pnpm check` for CI-level verification when the change spans multiple subsystems or affects a release path.

## Commits and pull requests

Use Conventional Commits with an imperative English subject:

```text
feat: add scheduled task filtering
fix: recover interrupted permission state
docs: clarify runtime installation
```

A pull request should: explain the problem and the chosen change; keep unrelated cleanup out of scope; link the relevant issue or design record; list the checks that actually ran; include screenshots for visible UI changes; include tests for behavior changes; update public documentation when behavior, configuration, or APIs change; and avoid committing secrets, generated build output, or local environment files.

By contributing, you agree that your contribution is licensed under the [Apache License 2.0](https://github.com/ysmjjsy/CodeY/blob/main/LICENSE).
