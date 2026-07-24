---
title: Getting started
description: Build and run the CodeY desktop app from source.
---

CodeY currently requires building from source. This page covers prerequisites, development run, production build, and common verification commands.

## Prerequisites

- Node.js `24.12.0`
- pnpm `11.7.0`
- Rust `1.96` or newer
- The [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your operating system

For native computer-control development, you also need:

- macOS 14 or newer and Swift 6 (`apps/computer-use-macos`)
- .NET 8 and the Windows 10.0.22621 SDK (`apps/computer-use-windows`)

## Run from source

```sh
git clone https://github.com/ysmjjsy/CodeY.git
cd CodeY
pnpm install
pnpm dev
```

`pnpm dev` builds the daemon sidecar and native computer-use runtime before starting the Tauri development app.

On first run:

1. Open a project directory.
2. Configure a model provider under **Settings → Models**.
3. Create a conversation and start your first task.

## Production build

```sh
pnpm build
```

The production build bundles the desktop frontend, daemon sidecar, browser runtime, and the native computer-use runtime supported on the current platform.

## Development and verification

Use the narrowest check that covers a change:

```sh
pnpm check:frontend:fast  # frontend typecheck, lint, and unit tests
pnpm check:rust:fast      # Rust formatting and focused contract tests
pnpm check:quick          # policy checks plus fast frontend and Rust checks
pnpm check                # complete CI-level verification
```

CI enforces architecture boundaries, including daemon ownership of agent capabilities, brokered tool networking, generated protocol consistency, frontend design tokens, and the absence of production fakes in authorization or orchestration paths.

Read [Contributing](/en/docs/contributing/) before submitting changes.
