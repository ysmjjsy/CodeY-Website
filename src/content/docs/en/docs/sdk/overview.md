---
title: SDK overview
description: The CodeY Agent Runtime SDK exposes the durable Agent Harness through a local, language-neutral service.
---

The CodeY Agent Runtime SDK exposes the repository's durable Agent Harness through a local, language-neutral service. TypeScript, Python, and Rust clients use the same schema and the same daemon execution path.

## Availability

The TypeScript and Python packages are not yet published to public registries. During pre-release development, use the source packages in `packages/agent-sdk` and `sdks/python` together with a matching locally built runtime. Tagged releases are designed to publish exact-version platform runtime artifacts and SDK packages together.

- The npm package selects an exact-version platform runtime package.
- Python deployments may bundle the matching runtime beside the wheel or pass an explicit verified `runtime_path`.
- Node.js 24+, Python 3.11+, and Rust 1.96+ are supported.

## TypeScript quickstart

Set `ANTHROPIC_API_KEY`, then run the complete [TypeScript example](https://github.com/ysmjjsy/CodeY/blob/main/examples/agent-sdk/typescript/quickstart.ts). It:

1. Starts the runtime;
2. Stores a provider profile and credential;
3. Creates an immutable AgentDefinition revision;
4. Executes a query.

The [Python example](https://github.com/ysmjjsy/CodeY/blob/main/examples/agent-sdk/python/quickstart.py) uses the same public operations.

```ts
import { CodeY } from '@codey/agent-sdk'

await using runtime = await CodeY.start({ applicationId: 'com.example.agent' })

const definition = await runtime.client.definitions.create(spec)
const run = await runtime.client.agent(definition.id).query({
  blocks: [{ type: 'text', text: 'Review this project.' }],
})
console.log(await run.result())
```

`RunHandle.result()` works without consuming the event iterator. One internal event pump owns cursor recovery and deduplication.

## Boundaries

This SDK is not a remote multi-tenant API. Browser applications must call it from a trusted backend. `codey-harness-sdk` remains the separate embedded Rust assembly API.

## Further reading

- [Agent definitions and sessions](/en/docs/sdk/agent-definitions/)
- [Runtime and recovery](/en/docs/sdk/runtime-and-recovery/)
- [Extensions, tools, and interactions](/en/docs/sdk/extensions/)
- [Errors and troubleshooting](/en/docs/sdk/errors/)
- [Public API coverage](/en/docs/sdk/public-api/)
