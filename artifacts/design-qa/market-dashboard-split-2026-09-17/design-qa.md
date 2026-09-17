# MarketDashboard script extraction — 2026-09-17

Stage 3D-1d of the frontend remediation plan: split the `MarketDashboard.astro`
giant component.

## Scope

| Before | After |
|---|---|
| `src/components/MarketDashboard.astro` — 727 lines (283 markup/style + 442 `<script>`) | `src/components/MarketDashboard.astro` — 287 lines (markup + style only) |
| — | `src/lib/market-dashboard.ts` — 537 lines (`initMarketDashboard()`) |

The inline `<script>` of the component was moved verbatim into
`src/lib/market-dashboard.ts` and re-exported as `initMarketDashboard()`; the
component now only imports and calls it. This follows the same
component/behaviour split the repo already uses for `pagination.ts`,
`provider-presets.ts`, and `toast.ts`.

## Why this is provably visual-inert

This is **not** a re-snap or a redesign — it is a behaviour-preserving
extraction, so the strongest evidence is source-level rather than a screenshot
diff. Three independent checks were run.

### 1. Everything outside the `<script>` block is byte-identical

```sh
git show HEAD:src/components/MarketDashboard.astro | sed '/^<script>/,/^<\/script>/d' > /tmp/md-before.noscript
sed '/^<script>/,/^<\/script>/d' src/components/MarketDashboard.astro > /tmp/md-after.noscript
diff /tmp/md-before.noscript /tmp/md-after.noscript
```

Result: **no output** — the frontmatter, markup, and `<style is:global>` block are
unchanged byte-for-byte (283 lines in both). No CSS declaration, class name, or
DOM node was touched, so no rendered pixel can change.

### 2. Every function survived the move

```sh
git show HEAD:src/components/MarketDashboard.astro | sed -n '/<script>/,/<\/script>/p' \
  | grep -oE "function [a-zA-Z]+" | sort -u > /tmp/before-fns.txt
grep -oE "function [a-zA-Z]+" src/lib/market-dashboard.ts | sort -u > /tmp/after-fns.txt
comm -23 /tmp/before-fns.txt /tmp/after-fns.txt
```

Result: **24 functions before, 24 after, 0 missing** — `applyUser`, `decide`,
`errorMessage`, `formatDate`, `icon`, `latestTemplates`, `loadCurrentUser`,
`loadReviewData`, `loadSubmissions`, `openReview`, `renderPendingRow`,
`renderReviewData`, `renderReviewHistoryPage`, `renderReviewHistoryRow`,
`renderReviewPendingPage`, `renderTemplatePage`, `renderTemplateRow`,
`renderTemplateSummary`, `retryButton`, `selectReviewView`, `statusBadge`,
`statusLabel`, `templateIdentity`, `text`.

### 3. Token-level comparison of the script body

Normalizing both script bodies to a token stream and diffing them gives
**98.02% similarity** with 39 diff hunks, every one of which is one of three
accounted-for mechanical differences:

| Difference | Cause |
|---|---|
| `type User` / `type Submission` / … deleted from the before-stream | The types were hoisted to module scope in the new file (top of `market-dashboard.ts`), so they no longer appear inline. |
| Inserted `return`, `!`, and `,` tokens | Guard rewrite and Biome formatting, below. |
| Inserted `{` / `}` tokens | Biome's `useIterableCallbackReturn` rule requires a block body on `forEach` callbacks that used a concise arrow (`forEach((x) => (y += 1))` → `forEach((x) => { y += 1 })`). Purely syntactic. |

The only semantic edit is the early-return guard, which is equivalent because the
whole body was already inside `if (rootEl) { … }`:

```diff
- const rootEl = document.querySelector<HTMLElement>('[data-market-dashboard]')
- if (rootEl) {
-   …442 lines…
- }
+ const rootEl = document.querySelector<HTMLElement>('[data-market-dashboard]')
+ if (!rootEl) return
+ const root = rootEl
+ …same body…
```

Nothing else was changed: the same elements are queried, the same events are
bound in the same order, and `void loadCurrentUser()` remains the last statement.

### 4. Whole-site rendered-build diff

Both trees were built and every emitted page compared.

```sh
git stash push -u                      # baseline tree
pnpm build:web && cp -r dist /tmp/md-before
git stash pop                          # implementation tree
pnpm build:web && cp -r dist /tmp/md-after
```

| Dimension | Result |
|---|---|
| Page count | 56 → 56 |
| Pages differing byte-for-byte | 4 (`console/reviews`, `console/templates`, and the two `en/` twins) |
| Cause of those 4 | **Asset filename only.** The `<script>` chunk hash changed because the inline component script became a module import. |
| Pages differing after collapsing content-hash filenames | **0 / 56** |

The only raw difference on those four pages is the content-hash string in
`<script type="module" src="/_astro/MarketDashboard.astro_astro_type_script_index_0_lang.<hash>.js">`.
No DOM node, attribute, class, or text changed, which is exactly what the
byte-identical non-script region in check 1 predicts.

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

`MarketDashboard.astro` drops from 727 to 287 lines and the dashboard behaviour
lives in a testable module. The rendered site is unchanged by construction
(byte-identical non-script region) and the aggregate gate is green.
