# Download script extraction — 2026-09-17

Stage 3D-1c of the frontend remediation plan: split the `Download.astro` giant
component.

## Scope

| Before | After |
|---|---|
| `src/components/Download.astro` — 1086 lines (543 markup/style + 543 `<script>`) | `src/components/Download.astro` — 547 lines (markup + style only) |
| — | `src/lib/download.ts` — 547 lines (`initDownload()` plus three module-scope types) |

The inline `<script>` was moved into `src/lib/download.ts` and exported as
`initDownload()`; the component now only imports and calls it. It follows the
component/behaviour split the repo already uses for `pagination.ts`,
`provider-presets.ts`, `toast.ts`, `market-dashboard.ts`, and `cloud-admin.ts`.

## Why this is provably visual-inert

This is a behaviour-preserving extraction. The strongest available evidence is
source-level plus a rendered-build diff.

### 1. Everything outside the `<script>` block is byte-identical

```sh
git show HEAD:src/components/Download.astro | sed '/^<script>/,/^<\/script>/d' > /tmp/d-b.noscript
sed '/^<script>/,/^<\/script>/d' src/components/Download.astro > /tmp/d-a.noscript
diff /tmp/d-b.noscript /tmp/d-a.noscript
```

Result: **no output** — frontmatter, markup, and `<style>` are unchanged
byte-for-byte (543 lines in both). No CSS declaration, class, or DOM node moved.

### 2. Token-level comparison of the script body

Dropping punctuation-only formatting tokens (`; , { } ( )`) and diffing the two
token streams gives **99.91% similarity** with exactly **3** non-equal hunks:

| Hunk | Cause |
|---|---|
| `export function initDownload : void` inserted | The wrapper that makes the body callable from the component. |
| `!` inserted | Guard rewrite, below. |
| `return` inserted | Guard rewrite, below. |

There is no fourth difference. Unlike `CloudAdmin`, this script was already close
to Biome's formatting: only **9** of its 489 non-blank lines exceeded the
100-column limit, and each was re-wrapped across lines without changing any
token. Non-blank lines go from 489 to 510 purely from those wraps (and the
formatter's normalisation of `[...grid?.querySelectorAll(…) ?? []]` to
`[...(… ?? [])]`).

The only semantic edit is the guard, which is equivalent because the entire body
was already inside `if (root) { … }`:

```diff
- const root = document.querySelector<HTMLElement>('[data-download-root]')
- if (root) {
-   …543 lines…
- }
+ const root = document.querySelector<HTMLElement>('[data-download-root]')
+ if (!root) return
+ …same body…
```

Note this script used `if (root)` rather than the `const root = rootEl` re-bind
seen elsewhere, so the narrowed `root` is used directly and no second binding is
needed. Nothing else changed: the same elements are queried, the same listeners
are bound in the same order, and `void loadReleases()` remains the last statement.

### 3. Whole-site rendered-build diff

```sh
git stash push -u                                  # baseline tree
pnpm build:web && cp -r dist /tmp/md-after
git stash pop                                      # implementation tree
pnpm build:web && cp -r dist /tmp/dl-after
```

| Dimension | Result |
|---|---|
| Page count | 56 → 56 |
| Pages differing after collapsing content-hash filenames | **0 / 56** |

## Verification

| Gate | Result |
|---|---|
| `pnpm lint` (Biome) | pass — 0 errors |
| `pnpm typecheck` (`tsc --noEmit`) | pass |
| `pnpm check:astro` | pass |
| `pnpm test` (Vitest) | pass |
| `pnpm build:web` | pass — 56 pages built |

`pnpm check` (the aggregate gate) exits 0.

## Final result

`Download.astro` drops from 1086 to 547 lines and the release-feed behaviour
lives in a linted, typechecked module. The rendered site is unchanged (56/56
pages identical after asset-hash normalization) and the gate is green.
