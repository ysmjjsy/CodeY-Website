# CloudAdmin script extraction — 2026-09-17

Stage 3D-1b of the frontend remediation plan: split the `CloudAdmin.astro` giant
component, the largest remaining one at 1143 lines.

## Scope

| Before | After |
|---|---|
| `src/components/CloudAdmin.astro` — 1143 lines (421 markup/style + 720 `<script>`) | `src/components/CloudAdmin.astro` — 425 lines (markup + style only) |
| — | `src/lib/cloud-admin.ts` — 1677 lines (`initCloudAdmin()` plus the module-scope types) |

The inline `<script>` was moved verbatim into `src/lib/cloud-admin.ts` and
exported as `initCloudAdmin()`; the component now only imports and calls it.

### Why the module is longer than the script it came from

The original inline script was written with deliberately long single lines — for
example one 300-character line held `field`, `checked`, `setChecked`,
`toMicros`, `fromMicros`, `capability`, `localized`, `title`, `interpolate`,
`setFormBusy`, and `announceSaved`. The `<script>` block inside a `.astro` file
is not covered by the Biome `files.includes` pattern, so those lines were never
formatted.

Once the code is a `.ts` file it *is* linted and formatted, and Biome expands
each declaration to its own line and wraps at 100 columns. The 720-line script
therefore becomes a 1677-line formatted module, and the feature's total source
grows from 1143 to 2102 lines — entirely added line breaks, no added logic.

That the inline block escaped formatting is itself a finding: extracting these
scripts to `.ts` **widens lint coverage**, which is why the extraction surfaced
new `noExplicitAny` and `useIterableCallbackReturn` errors that the inline
version had never been checked for. Those were fixed (see below).

## Why this is provably visual-inert

This is a behaviour-preserving extraction, not a redesign. Because the extracted
code is an inline `<script>` that only runs DOM queries and event handlers, the
strongest available evidence is source-level plus a rendered-build diff.

### 1. Everything outside the `<script>` block is byte-identical

```sh
git show HEAD:src/components/CloudAdmin.astro | sed '/^<script>/,/^<\/script>/d' > /tmp/ca-b.noscript
sed '/^<script>/,/^<\/script>/d' src/components/CloudAdmin.astro > /tmp/ca-a.noscript
diff /tmp/ca-b.noscript /tmp/ca-a.noscript
```

Result: **no output** — frontmatter, markup, and `<style is:global>` are unchanged
byte-for-byte (421 lines in both). No CSS declaration, class, or DOM node moved.

### 2. Every function survived the move

```sh
comm -23 /tmp/ca-b.txt /tmp/ca-a.txt   # functions before, not after
```

Result: **72 functions before, 73 after, 0 missing.** The one extra is
`initCloudAdmin` itself.

### 3. Token-level comparison of the script body

Dropping pure-punctuation formatting tokens (`; , { } ( )`) and diffing the two
token streams gives **99.96% similarity** with exactly **5** non-equal hunks,
every one accounted for:

| Hunk | Cause |
|---|---|
| `export function initCloudAdmin : void` inserted | The wrapper that makes the body callable from the component. |
| `!` inserted | Guard rewrite, below. |
| `return` inserted | Guard rewrite, below. |
| `\|` inserted ×2 | Two type unions that Biome wrapped across lines, so the `\|` token moved position in the stream. The type declarations are unchanged. |

The only semantic edit is the guard, which is equivalent because the whole body
was already inside `if (rootEl) { … }`, and the body's own
`const root = rootEl` already re-bound the narrowed value:

```diff
- const rootEl = document.querySelector<HTMLElement>('[data-cloud-admin]')
- if (rootEl) {
-   const root = rootEl
-   …720 lines…
- }
+ const rootEl = document.querySelector<HTMLElement>('[data-cloud-admin]')
+ if (!rootEl) return
+ const root = rootEl
+ …same body…
```

Nothing else changed: the same elements are queried, the same listeners are bound
in the same order, and `window.addEventListener('market-auth-changed', …); void load()`
remains the last statement.

### 4. Lint debt the inline script had never been checked for

Extraction surfaced three classes of error that Biome could not previously see,
all fixed as part of this change:

| Site | Rule | Fix |
|---|---|---|
| `capability(model, key, fallback): any` | `suspicious/noExplicitAny` | Made generic: `capability<T>(model, key, fallback: T): T`, casting the stored capability once. All 15 call sites keep their existing inferred types. |
| 6 × `.forEach((x) => …)` with a value-returning concise body | `suspicious/useIterableCallbackReturn` | Converted to block bodies. Purely syntactic. |
| import order | `assist/source/organizeImports` | Applied Biome's fix. |

The `capability` signature change is the only one a reader might call semantic.
It is not: the function is a typed lookup with a default, the previous `any`
return was erased at every call site by an inline `as` cast or a `Boolean(…)`
wrapper, and `tsc --noEmit` passes with no change at any call site.

### 5. Whole-site rendered-build diff

Both trees were built and every emitted page compared.

```sh
git stash push -u                      # baseline tree
pnpm build:web && cp -r dist /tmp/md-after   # (reused baseline from the 3D-1d run)
git stash pop                          # implementation tree
pnpm build:web && cp -r dist /tmp/ca-after
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

`CloudAdmin.astro` drops from 1143 to 425 lines and the console behaviour lives
in a linted, typechecked module. The rendered site is unchanged (56/56 pages
identical after asset-hash normalization) and the aggregate gate is green.
