# Spacing tokenization and radius convergence — 2026-09-16

Stage 2B of the frontend remediation plan: extract the token layer, converge bare `px`
and the radius scale, split `market.css`, and remove `!important`.

## Scope

| Task | Change |
|---|---|
| 2B-1 | Token layer extracted from `landing.css` into `src/styles/tokens.css` |
| 2B-2 | Numeric (`--space-N`) and semantic (`--space-2xs…3xl`) spacing scales defined |
| 2B-3 | 263 bare `px` values in `gap`/`padding`/`margin` replaced with `--space-*` tokens |
| 2B-4 | Radius scale converged onto `--radius-sm/md/lg/xl/pill` |
| 2B-5 | `market.css` (1838 lines) split into catalog / detail / upload / shared |
| 2B-6 | Dead duplicate declarations removed (see "Cascade safety" below) |
| 2B-7 | `!important` in `src/styles/*.css`: 8 → 0 |

## Comparison target

- Source visual truth: the previous website build, reproduced by checking out `HEAD`
  (`38dfaef`) and running `astro build` on the unmodified tree.
- Browser-rendered implementation: the rebuilt site after the refactor.
- Viewport and pixels: `1440 × 1000` (plus `680` for the market mobile breakpoint),
  device scale factor 1, `reducedMotion: reduce`, `colorScheme` forced per capture.
- Both states render the same markup; only the stylesheets differ, so the comparison
  isolates exactly the change under review.

## Evidence

`before`/`after` pairs captured in this directory:

- `home-dark-1440`, `home-light-1440` — landing page
- `market_-dark-1440`, `market_-dark-680` — the page whose radius actually changed

Objective pixel comparison (`sharp`, full-page captures, same canvas):

| Surface | Size before → after | Differing px | Max Δ | Mean Δ |
|---|---|---|---|---|
| home-dark-1440 | 1440×4723 → 1440×4723 | 0 (0.000%) | 0 | 0.000 |
| home-light-1440 | 1440×4723 → 1440×4723 | 0 (0.000%) | 0 | 0.000 |
| market_-dark-1440 | 1440×1364 → 1440×1364 | 182 (0.009%) | 93 | 0.003 |
| market_-dark-680 | 680×1624 → 680×1624 | 182 (0.016%) | 93 | 0.003 |

Page heights are byte-identical, so no layout reflow occurred. The market differences are
confined to corner pixels, which is the intended radius convergence.

## Computed-style verification

Beyond the screenshots, every layout-affecting computed style was captured for 12
page/theme/width combinations (559 elements on the landing page alone) using the
repository's `scripts/style-snapshot.mjs`, and compared with `scripts/style-diff.mjs`.

Procedure and result:

1. **Baseline stability.** The same build was captured twice; 9 cells on `/pricing/`
   differed between identical captures. `/pricing/` renders its catalog state from a
   client fetch, which the static capture server answers with 404, so those cells are
   inherently non-deterministic. They are excluded from the comparison below.
2. **Spacing tokenization (2B-3) is computed-style neutral.** Comparing `HEAD` against
   the tokenised build, after excluding the 9 baseline-flaky cells, the differences are
   **204 cells, all four `border-*-radius` properties** — i.e. only the intended radius
   convergence. **No `padding`, `margin`, `gap`, or geometry property changed at all.**
3. **Dead-declaration removal (2B-6) is computed-style neutral.** Comparing the build
   before and after the removal yields **0 differences**.
4. **Split (2B-5) is computed-style neutral.** The split happened before step 2 and is
   covered by the same comparison.

## Cascade safety

`market.css` contained 56 selectors defined more than once. Analysis showed 17 of the 27
duplicate groups are **deliberate cascade override chains** (the later block intentionally
re-states a property with a different value), not redundancy. Naively merging those into a
single block changes rendering.

A full merge was implemented and measured: it produced **24 real computed-style
differences** (notably `.market-results` `padding-top: 0 → 26px` and page height
`1624px → 1627px` at the 680px breakpoint). **It was reverted.**

What shipped instead is the provably safe subset: a declaration is removed only when a
**later block with the same at-rule context and the same selector** sets the same
property. Same selector ⇒ same specificity ⇒ the earlier declaration can never win, so
deleting it cannot change any computed value. 33 dead declarations were removed and one
block became empty. Verified as 0 differences (step 3 above).

Remaining duplicate groups (25) are retained deliberately: they are override chains whose
consolidation would require reordering, which is a behavioural change rather than a
cleanup, and is out of scope for this stage.

## Findings

- `!important` is gone from `src/styles/*.css`. The 8 occurrences were replaced by
  specificity or `@layer` ordering; `landing.css` documents the `:root:root` technique used
  for the reduced-motion override.
- Radius scale: 21 distinct literal values (`3px`…`20px`) collapsed to 0 literal values.
  Every `border-radius` now resolves to `--radius-sm/md/lg/xl/pill` (plus `50%` for circles).
- The two exceptions outside the documented mapping are sub-scale decorations that have no
  corresponding step: `.market-new` (`4px` → `--radius-sm` 6px) and
  `.market-category.is-active::after` (`3px 3px 0 0` → `--radius-sm` 6px). Both are
  sub-pixel-scale at 1× and were accepted as part of the convergence.
- The spacing scale is two-layered: `--space-N` is the literal source of truth (2px base),
  and the semantic names are aliases onto it, so the rhythm can be retuned in one place.

## Final review

The refactor is verified value-preserving apart from the intended radius convergence.
`pnpm check` (typecheck + astro check + lint + test + build) passes.

Residual, deliberately not addressed here: the 25 remaining duplicate selector groups in
the market stylesheets are cascade override chains; consolidating them would change
rendering and belongs to a follow-up task with its own visual review.
