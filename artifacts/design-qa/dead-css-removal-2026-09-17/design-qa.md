# Dead CSS removal — 2026-09-17

Stage 2A of `FRONTEND-REMEDIATION-PLAN-3.md`: delete the dead rules found by the
round-two audit.

## Scope removed

| Stylesheet | Rules removed | Selectors dropped |
|---|---|---|
| `market-catalog.css` | 27 | 28 |
| `market-upload.css` | 9 | 15 |
| **Total** | **36** | **43** |

`market-catalog.css` + `market-upload.css` go from 1246 to 1000 lines.

The bulk is one abandoned layout generation. `011b16c` redesigned the marketplace
page from a sidebar-and-grid layout to a single-column browser, and the sidebar
CSS was never deleted:

| Group | Rules |
|---|---|
| `.market-sidebar`, `-heading`, `-logo`, `-tabs`, `-section`, `-tags`, `-note` (+ pseudo-elements and `:hover`) | 22 |
| `.market-search-icon`, `.market-category-icon`, `.market-publisher-dot`, `.market-load-more` | 4 |
| `.market-field*` (upload form, replaced by `ui-field`) | 9 |
| `.market-file`, `.market-resource-option*` | 5 |

## How "dead" was determined

Not by grep. The live set is the **built output**:

- every `class="…"` token in `dist/**/*.html` (592 distinct classes on this site)
- every identifier in `dist/_astro/*.js`, which covers classes that only ever
  exist at runtime via `className =` / `classList`, and
- an explicit allowlist of runtime-*built* prefixes (`market-card-icon-${kind}`,
  `release-panel-${…}`, `ui-page-header-${align}`, `btn`, `is`, `ph`, `astro`).

A selector part counts as dead when **any** class in it can never be applied:
a descendant selector like `.market-sidebar-tabs .is-active` cannot match if
`.market-sidebar-tabs` is never in the DOM, even though `is-active` is used
elsewhere. This is sound for these two files specifically because neither
contains a `:not(...)` that would invert the test; that was checked before
relying on it.

Two false positives from the audit's first pass are *not* removed, and are
documented so nobody "cleans" them later: `.market-card-icon-*` and
`.release-panel-*` / `.release-tab-*` are built by template literals at runtime.

## Shared selector lists

Two rules in `market-upload.css` group a dead selector with a live one:

```css
.market-select,
.market-field input,
.market-field textarea { … }
```

These keep `.market-select` (still used by `MarketDetail.astro`) and drop only the
two dead entries. Deleting the whole rule would have removed live styling — the
removal script handles this case explicitly, and the live selector was verified
present afterwards.

## Evidence that nothing changed visually

`scripts/style-snapshot.mjs` against the pre-removal and post-removal builds:

```text
IDENTICAL: no computed-style differences
exit 0
```

`/pricing/` is excluded because it renders an async loading state and is
non-deterministic (established during stage 1B: comparing the *same* server to
itself reproduces the same 9 differences).

Corroborating signals:

- CSS still parses cleanly under Biome (no `parse` diagnostics).
- The build still emits 56 pages.
- Remaining `noDescendingSpecificity` warnings fall from 8 to 5, because three of
  them were "lower specificity than `.market-sidebar-heading div span`", a
  selector that no longer exists.

## Process note

The removal went through three failed attempts before the working one, each
caught by inspection rather than by the gate:

1. A variable-shadowing bug (`sel` string vs `.split`).
2. The script matched single-line selectors only, so it missed both the two
   multi-line shared lists and every rule nested inside `@media`.
3. The trimmed-list replacement dropped the leading whitespace span, welding
   `.market-card { … }.market-select { … }` onto one line — valid CSS by luck,
   but clearly wrong output.

The lesson is recorded here rather than only in the commit: **a text-level CSS
rewriter must be validated by re-parsing its output, not by eye.** The final run
was checked by re-reading the shared-list regions and by running Biome's parser
over the result.
