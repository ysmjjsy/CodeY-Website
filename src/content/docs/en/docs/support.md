---
title: Support and security policy
description: How to get help, submit issue reports, and report security vulnerabilities.
---

CodeY is pre-release software maintained through this GitHub repository.

## Where to ask

- Reproducible bugs: use the [bug report form](https://github.com/ysmjjsy/CodeY/issues/new?template=bug_report.yml).
- Focused feature requests: use the [feature request form](https://github.com/ysmjjsy/CodeY/issues/new?template=feature_request.yml).
- Development questions: open an issue and describe the code area, goal, and checks already attempted.
- Security vulnerabilities: follow the [security policy](#security-policy) below. Do not post exploit details in a normal issue.

Before opening an issue, search existing issues and read the [documentation](/en/docs/intro/) and [contributing guide](/en/docs/contributing/).

## Information to include

- CodeY version or commit SHA
- Operating system and architecture, installation method
- Node.js, pnpm, and Rust versions when building from source
- Model provider and protocol, without credentials
- Exact steps and expected behavior
- Relevant logs, screenshots, or a minimal reproduction repository
- Whether the problem still occurs after restarting CodeY

Remove API keys, access tokens, private file contents, personal data, and proprietary prompts before attaching logs or screenshots.

## Support scope

The project does not provide a response-time guarantee. General model-provider outages, billing disputes, and defects isolated to third-party MCP servers or plugins should be reported to the relevant provider or project.

## Security policy

CodeY is in `0.1.x` pre-release development. Security fixes are applied to the current `main` branch.

**Do not disclose exploit details, credentials, private data, or proof-of-concept code in a public issue.**

Private vulnerability reporting is not currently enabled for this repository. To request a private reporting channel:

1. Open a [security contact request](https://github.com/ysmjjsy/CodeY/issues/new?template=security_contact.yml) containing only the affected component and a request for private follow-up.
2. Do not include reproduction steps or technical details in that public request.
3. Wait for the maintainer to establish a private channel before sharing sensitive information.

A useful private report includes: affected commit, version, and platform; affected component and trust boundary; prerequisites and reproducible steps; impact and realistic attack scenario; proof of concept, if safe to share; and suggested mitigation, if known.

Reports are especially useful when they involve: daemon local IPC authentication or isolation; permission decisions or approval bypass; sandbox, workspace, filesystem, or symlink escape; network broker or local-port policy bypass; secret storage, redaction, or credential exposure; plugin, skill, MCP, browser, or extension trust validation; computer-control authorization or protected-mode escape; runtime artifact signature or update verification; and task recovery that repeats a harmful external side effect.

If a vulnerability exists only in an upstream dependency, report it to that project first. Report it here as well when CodeY's use of the dependency creates a distinct exploit path or requires a coordinated release.
