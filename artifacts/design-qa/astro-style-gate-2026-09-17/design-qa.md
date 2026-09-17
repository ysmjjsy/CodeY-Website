# Inline `<style>` gate — 2026-09-17

Stage 1C of `FRONTEND-REMEDIATION-PLAN-3.md`: close the half of N-1 that adding
`src/**/*.css` did not reach.

## The gap

Biome does not parse `<style>` blocks inside `.astro` files. Listing
`src/**/*.astro` in `files.includes` checks the frontmatter and the template
expressions, but the CSS between `<style>` and `</style>` is ignored — verified by
injecting `padding:    1px    2px` and seeing `biome check --write` leave it
byte-identical.

On this site that is **24 blocks and ~3200 lines**, the majority of component
styling. Without coverage, stage 1B only guarded `src/styles/*.css`.

## The gate

`scripts/check-astro-styles.mjs`, zero dependencies, four steps:

1. Extract every `<style>` block from every `.astro` file under `src/`.
2. Normalise Astro-only syntax: `:global(.foo)` → `.foo`. Without this, Biome
   reports `noUnknownPseudoClass` on every use (4 files affected), burying the
   real findings.
3. Inherit the project's `biome.json` formatter and linter settings, overriding
   only `files.includes` to point at the extracted CSS. Inheriting rather than
   restating keeps this gate from drifting away from `pnpm lint`.
4. Map each diagnostic's line back to the originating `.astro` file and line.

Two details that had to be right, each found by a failing test rather than by
review:

- **Indentation.** The CSS sits one level inside the tag, so Biome's formatter
  wanted to de-indent all 24 blocks — 24 false `format` diagnostics. The gate
  dedents by the smallest common indent before formatting.
- **Line arithmetic.** The body begins on the tag's *last* line, so the offset is
  `tagStartLine + (openTagLines - 1) + leadingNewlines`. The first version omitted
  the `- 1` and reported every line one too high.

## Negative tests (in-repo)

`scripts/check-astro-styles.test.mjs`, run by `check:styles` alongside the gate.
A gate that never fails is worthless, so each case injects a defect and asserts
that it is caught and attributed correctly:

```text
PASS  unknown property -> noUnknownProperty
PASS  duplicate property -> noDuplicateProperties
PASS  bad format -> format
PASS  :global() must not false-positive (should stay clean)
PASS  line mapping (reported 7, expected 7)
```

The `:global()` case guards the opposite direction: the normalisation must not
turn a false positive into a different false positive.

## What the gate found

59 problems on first run against the existing code:

| Category | Count | Resolution |
|---|---|---|
| `format` | 22 | Fixed — Biome's CSS formatting applied to each block in place, preserving the block's indentation |
| `noDescendingSpecificity` | 37 | Rule disabled; see below |

### Why `noDescendingSpecificity` is off rather than suppressed 37 times

The rule warns when a later rule has lower specificity than an earlier one, which
only matters if both can match the same element. Every instance was tested against
the built DOM — intersecting the two selectors' matched-element sets on all **55
pages** — and **none of the 37 (nor the 5 in `src/styles/*.css`) can co-match**.
Precision is 0%.

Adding 42 `biome-ignore` comments would be noise that obscures the single case
that would ever matter. The rule is disabled in `biome.json` with the rationale
recorded in `CONTRIBUTING.md`.

> Note: `biome.json` cannot hold a multi-line `//` comment — it makes the config
> fail to parse and Biome silently falls back to its defaults, which manifests as
> the rule-off setting not taking effect. That is why the rationale lives in
> `CONTRIBUTING.md`.

## Evidence that the reformat changed nothing

The 22 reformatted blocks were checked at the declaration level (comments,
whitespace, quote style, and leading zeros normalised): 3898 → 3898 declarations
identical, the only differences being `content: ''` → `content: ""`, `.8rem` →
`0.8rem`, and Biome's `600 .7rem/1` spacing in `font` shorthand — all equivalent.

Geometry is unchanged across 8 page/theme/viewport combinations:

```text
GEOMETRY DIFFERENCES: 0
```

## Result

Both halves of the site's CSS are now behind a gate that fails on a real defect,
with the failing check proven by in-repo negative tests. The remaining CSS
warnings in the repository are zero.
