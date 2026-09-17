# CSS formatting under the Biome gate — 2026-09-17

Stage 1B of `FRONTEND-REMEDIATION-PLAN-3.md`: bring `src/styles/*.css` under the
Biome formatter and prove the reformat is visually inert.

## Scope

`CodeY-Website/biome.json` listed only `.ts`, `.astro`, and `.mjs`, so the 10
stylesheet files (2967 lines) were never linted or formatted. Adding
`src/**/*.css` made Biome report 8 lint warnings **and** a formatting diff across
all 10 files.

The reformat changes 329 lines. Every one is cosmetic:

| Class of change | Example |
|---|---|
| Leading zeros normalised | `.92rem` → `0.92rem`, `.15s` → `0.15s` |
| Quote style normalised | `:root[data-theme='light']` → `:root[data-theme="light"]`, `content: ''` → `content: ""` |
| Value lists re-wrapped | long `background`/`box-shadow`/`font` values broken per Biome's rules |
| `@media` body indented | previously 0-indented rules now indented 2 spaces |

## Declaration-level proof

Normalising comments, whitespace, quote style, and leading zeros, all 1553
declarations across the 10 files are identical before and after:

```text
total declarations: 1553 -> 1553
ALL SEMANTICALLY IDENTICAL
```

This is the primary proof: the reformat cannot change rendering because no
declaration value changed.

## Computed-style proof

`scripts/style-snapshot.mjs` was run against the pre-format build and the
post-format build (12 page/theme/viewport cases, 30 layout-affecting properties
per element).

The first comparison reported 9 differences, all on `/pricing/`. This was
investigated rather than assumed benign, and turned out to be **flaky async
state, not a regression**: the page renders `<StateMessage class="catalog-state">`
while its catalog request is in flight, so a snapshot can catch it in either the
loading or the loaded state.

Control: comparing **two snapshots of the same server** reproduces the identical
9 differences on the identical properties (`height`, `display`, `width`,
`grid-template-columns`). A non-deterministic page cannot distinguish two builds.

Excluding `/pricing/`:

```text
$ node scripts/style-diff.mjs fmt-before-nopricing.json fmt-after-nopricing.json
IDENTICAL: no computed-style differences
exit 0
```

## Result

The reformat is proven inert twice over — at the declaration level (1553/1553
identical) and at the computed-style level (0 differences outside the one page
with non-deterministic rendering).

Note: `style-snapshot.mjs`'s page list should either drop `/pricing/` or wait for
`[data-state]` to settle; that is a harness improvement, not a product defect, and
is left for a future change rather than mixed into this one.
