# AGENTS.md

CodeY-Website is the CodeY marketing site and public documentation site (Astro + Starlight). It is a separate git repository from `../CodeY` and has no shared build.

The two repositories share exactly one contract: the brand-token contract in `BRAND-TOKENS.md`. Nothing else is shared.

## Repository map

| Path | What it is |
|---|---|
| `src/pages/` | Astro routes for the marketing pages |
| `src/components/` | Astro components |
| `src/layouts/` | Page layouts |
| `src/styles/` | The token layer (`tokens.css`) and page styles (`landing.css`, `starlight.css`) |
| `src/content/docs/` | Starlight documentation pages (`zh` default plus `en/`). This is published product content. |
| `src/i18n/` | Locale strings |
| `scripts/` | Build helpers and machine-enforced policy checks (`check-*.mjs`) |
| `server/market-server` | Local marketplace server used by the market pages |
| `.agents/notes/` | Decisions, recorded as they are made |

## Commands

```sh
pnpm dev      # dev server
pnpm build    # full build (runs the site build script)
pnpm check    # everything: typecheck, astro check, lint, styles, brand, scales, agent notes, test, test:server, build
```

Individual gates:

```sh
pnpm typecheck     # tsc --noEmit
pnpm check:astro   # astro check (templates and frontmatter types)
pnpm lint          # biome check .
pnpm check:styles  # CSS, including the <style> blocks inside .astro files
pnpm check:brand   # cross-repo brand-token contract against ../CodeY
pnpm check:scales  # breakpoints and font-size scale
pnpm test          # vitest (site + scripts)
pnpm test:server   # cargo test -p codey-market-server (54 tests)
```

`pnpm check` is the single entry point CI should run. Do not add a CI step list that drifts from it.

The market server is Rust and lives in the `server/market-server` workspace member. `pnpm test:server` gates its tests; CI installs a Rust toolchain (`dtolnay/rust-toolchain@stable`) because the package manager alone cannot run them. Before that was wired up, the server's tests existed but nothing ran them.

## Hard rules

- **CSS in two places, both gated.** `src/styles/*.css` is linted by Biome directly. `<style>` blocks inside `.astro` files are **not** parsed by Biome, so `scripts/check-astro-styles.mjs` extracts each block, restores `:global(...)`, runs the same `biome.json` rules, and maps line numbers back. Both paths run under `pnpm check:styles`.
- **The brand primary colour has one authority: the desktop app.** `../CodeY/apps/desktop/src/shared/styles/global.css` is authoritative. This repository must match it. `scripts/check-brand-tokens.mjs` reads both repositories and compares hex values character for character. Changing a brand colour means changing `BRAND-TOKENS.md` and both repositories together.
- **Design tokens only.** No raw palette classes, no arbitrary values where a token exists. `BRAND-TOKENS.md` lists the naming contract.
- **Breakpoints and font sizes come from the shared scale.** Keep the table in `CONTRIBUTING.md` in sync when changing either; `check:scales` enforces it.
- **UI-facing strings go through `src/i18n/`.** Both `zh` and `en` content trees exist under `src/content/docs/`; keep them in parity when editing docs pages.

## Generated and evidence files — do not hand-edit

- `dist/`, `target/` — build output.
- Visual-review evidence (before/after screenshots, source images) is kept **outside** the repository. The former `artifacts/design-qa/` and `qa/` trees accumulated 28 MB of dated captures that no code or gate depended on, and were removed. `.gitignore` blocks those paths from returning.

## Agent Notes — how decisions are recorded

Decisions are recorded in `.agents/notes/` from now on. Path is identity: `{lifecycle}/{class}/yyyy-mm-dd-topic.md`.

| Lifecycle | Meaning |
|---|---|
| `proposed/` | Designed, not yet built |
| `implemented/` | Landed. Kept in sync with the code. |
| `rejected/` | Considered and declined, kept only when it prevents a repeat |
| `archived/` | Frozen. Sealed by SHA-256 in `manifest.json`; never edited. |

Classes: `feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing`.

Write a note when a change touches behavior, structure, a cross-repo contract, tooling, the testing strategy, or a format. Skip mechanical edits: formatting, renames, pure styling, routine content edits.

Every note needs `## Problem` first and an `## Alternatives considered` section; state each rejected option's strongest case before saying why it lost. `## Consequences` states costs as well as benefits.

When the decision still stands and only facts changed, edit the owning note in place instead of opening a new one.

Verify with `pnpm check:agent-notes`.
