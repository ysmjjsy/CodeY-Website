# AGENTS.md — scripts/

Zero-dependency Node (`.mjs`) build helpers and machine-enforced policy gates for
this repository, plus the deployment script. Every check here exists to stop a
documented convention from drifting, and the four style/brand/scale gates ship a
paired negative test that proves each one actually fails on a defect.

## Responsibilities

- Run the site: `run-site.mjs` starts the market server, then either `astro dev` or a static `dist/` server that proxies the API, so everything is same-origin.
- Build the site and the market server: `build-site.mjs` runs the release Cargo build, then `astro build`.
- Gate CSS that Biome cannot see: `check-astro-styles.mjs` extracts every `<style>` block in `src/**/*.astro`, restores Astro's `:global(...)`, applies `biome.json`, and maps diagnostics back to the original file and line. Biome only lints `src/styles/*.css` directly.
- Gate the brand contract: `check-brand-tokens.mjs` asserts the alias names, resolves each alias target, compares the brand hex values against the desktop app character for character, and rejects cyan in any brand token.
- Gate the scales: `check-font-sizes.mjs` bans literal rem font sizes across both CSS locations; `check-breakpoints.mjs` freezes the permitted media-query widths and requires the reduced-motion guard in both stylesheet entry points.
- Gate the decision notes: `agent-note-tree.mjs` (shared library), `check-agent-note-tree.mjs` (folders, filenames, links), `check-agent-note-format.mjs` (headers, lifecycle sections, required `## Alternatives considered`), `check-archived-agent-notes.mjs` (SHA-256 seals plus an append-only manifest check).
- Prove CSS refactors inert: `style-snapshot.mjs` captures computed styles through Playwright, `style-diff.mjs` compares two snapshots and exits non-zero on any difference.
- Deploy: `deploy.sh` fast-forwards a clean `main`, runs `pnpm install --frozen-lockfile`, builds, restarts the systemd unit and health-checks it.

## Boundaries

- Do not add a CSS or formatting linter other than Biome; if a rule matters, add it to `biome.json` or extend an existing gate here.
- Do not add a runtime dependency. Every script uses `node:*` builtins except `style-snapshot.mjs`, which borrows Playwright from the desktop checkout and is deliberately not a website dependency.
- Do not widen `BREAKPOINTS` in `check-breakpoints.mjs` as cleanup — collapsing widths changes layout in the affected band and needs its own before/after evidence plus the `CONTRIBUTING.md` table.
- Do not relax the brand comparison to a warning silently; when the private `../CodeY` checkout is absent the cross-repo half is skipped with a printed warning, which is the expected behaviour in this repository's own CI.
- Do not let `pnpm check` and CI diverge. `.github/workflows/ci.yml` runs only `pnpm check`; add new gates to `package.json` instead of adding CI steps.
- Do not hand-edit `dist/`, `target/`, `.codey-market/` or the dated QA evidence.

## Key paths

| Path | What it does |
| --- | --- |
| `scripts/run-site.mjs` | `dev`/`start` runner: market server, Astro dev, or static `dist/` server proxying `/api/*` and `/.well-known/codey-*.json` |
| `scripts/build-site.mjs` | Release Cargo build for `codey-market-server`, then `astro build` (target `market` skips the site) |
| `scripts/check-astro-styles.mjs` | Biome over extracted `<style>` blocks, with `:global()` handling, dedent and line mapping |
| `scripts/check-astro-styles.test.mjs` | Negative cases (`noUnknownProperty`, `noDuplicateProperties`, `format`, `:global()` false positive) plus line-number accuracy |
| `scripts/check-brand-tokens.mjs` | Alias, alias-target, cross-repo hex and cyan checks against `BRAND-TOKENS.md` |
| `scripts/check-brand-tokens.test.mjs` | Backs up `src/styles/tokens.css`, injects one drift per case into the real file, then restores it |
| `scripts/check-font-sizes.mjs` / `.test.mjs` | Bans literal rem `font-size` and `font` shorthand; `clamp()`, `var(--text-*)` and non-rem units are exempt |
| `scripts/check-breakpoints.mjs` / `.test.mjs` | Freezes the permitted widths, ignores `max-width` outside `@media`, and asserts the reduced-motion guard |
| `scripts/agent-note-tree.mjs` | Shared note-tree source of truth: lifecycles, classes, archive layout, link validation |
| `scripts/check-agent-note-tree.mjs` | Directory, filename and internal-link check over `.agents/notes/` |
| `scripts/check-agent-note-format.mjs` / `.test.mjs` | Header and section gate; masking of code fences and HTML comments; runs under `node --test` |
| `scripts/check-archived-agent-notes.mjs` | Verifies archived notes against `manifest.json`; `--write` seals new files |
| `scripts/style-snapshot.mjs` | Playwright capture of computed styles across pages, themes and widths |
| `scripts/style-diff.mjs` | Diffs two snapshots grouped by property; non-zero exit on any change |
| `scripts/deploy.sh` | Git-pull, install, build, systemd restart and health-check deployment |

## Commands / Verification

- `pnpm check` — the single aggregator CI runs: typecheck, astro check, lint, styles, brand, scales, agent notes, test, build.
- `pnpm check:styles` — `check-astro-styles` plus `check-font-sizes` plus both negative-test scripts.
- `pnpm check:brand`, `pnpm check:scales`, `pnpm check:agent-notes` — the remaining gate groups, each running its own test script.
- `node scripts/style-snapshot.mjs <base-url> <out.json>` then `node scripts/style-diff.mjs <before.json> <after.json>` — the CSS-refactor proof.
- `node scripts/build-site.mjs market` — build only the Rust server.
