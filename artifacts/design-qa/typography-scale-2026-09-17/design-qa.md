# Typography scale — 2026-09-17

Stage 4A of `FRONTEND-REMEDIATION-PLAN-3.md`: replace 92 ad-hoc font sizes with an
eleven-rung scale.

## The scale

Added to `tokens.css`, all values integral at a 16px root:

| Token | rem | px |
|---|---|---|
| `--text-2xs` | 0.6875 | 11 |
| `--text-xs` | 0.75 | 12 |
| `--text-sm` | 0.8125 | 13 |
| `--text-base` | 0.875 | 14 |
| `--text-md` | 0.9375 | 15 |
| `--text-lg` | 1 | 16 |
| `--text-xl` | 1.125 | 18 |
| `--text-2xl` | 1.25 | 20 |
| `--text-3xl` | 1.5 | 24 |
| `--text-4xl` | 1.75 | 28 |
| `--text-5xl` | 2 | 32 |

The rungs were chosen from the data, not invented: weighted clustering over all 310
observed `font-size` declarations produced centroids at 10.8 / 11.8 / 12.9 / 14.4 /
17.0 / 22.8px, and four candidate scales were evaluated by how many sites each moved
and by how much. The chosen 11-rung set snaps 88% of sites by less than half a
physical pixel while keeping round numbers a reader can memorise.

This is deliberately **not** the same set as the desktop app's `--text-*` (9–15px).
The desktop is a dense control panel; the site is a reading surface. Both have a
scale and consume it; they need not agree on values.

## Migration

| Measure | Count |
|---|---|
| `font-size` declarations converted | 303 |
| `font:` shorthand sizes converted | 70 |
| Remaining literal rem font sizes | **0** |
| `clamp()` declarations preserved | 20 |

`clamp()` is exempt by design: fluid display type interpolates between two bounds
and is not a rung.

## Measured visual impact

Comparing the pre- and post-migration builds over 11 page/theme/viewport cases
(1979 elements changed size, counting inheritance):

| Delta | Count |
|---|---|
| < 0.25px | 1360 |
| < 0.5px | 479 |
| < 1px | 124 |
| **>= 1px** | **16** (12 distinct source declarations) |

The largest single shift is 1.6px. Every shift >= 1px is a snap with no closer rung:
`1.35rem` (21.6px) → `--text-2xl` (20px), `1.85rem` (29.6px) → `--text-4xl` (28px),
`0.62rem` (9.92px) → `--text-2xs` (11px). These are the intended convergence, not
accidents.

### Layout integrity

Font sizes legitimately reflow text, so geometry differences are expected here —
unlike the earlier refactors, where zero differences was the bar. What was checked
instead is that no **container** broke:

- Horizontal movement is confined to text and intrinsically-sized controls: 291
  inline elements plus 53 containers whose width follows their content
  (`nav-links`, a `theme-toggle` label, the `market-search` form, its `input`).
  No fixed-width or grid-track container changed width beyond its own text.
- Largest height delta 20.7px, on wrapped text.
- An explicit overflow scan found no newly clipped element. The single candidate
  (`span` in `.nav-brand`, `scrollWidth` 55 → 56) has `clientWidth: 1` and was
  already reported before the change; it is measurement jitter on the 1px
  `.sr-only`-adjacent box, not a regression.

## Regression guard

`scripts/check-font-sizes.mjs` fails on any literal rem font size in either
`src/styles/*.css` or a `<style>` block in `src/**/*.astro`, exempting `clamp()`
and non-rem units. `scripts/check-font-sizes.test.mjs` proves the gate catches both
declaration forms at the right line and does not false-positive on `clamp()`,
tokens, or `em`. Both run as part of `check:styles`.

Screenshots for every page above are committed alongside this file
(`*.before.png` / `*.after.png`).
