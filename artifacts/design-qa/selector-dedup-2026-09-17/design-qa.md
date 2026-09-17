# Cross-block duplicate property merge — 2026-09-17

Stage 3A of `FRONTEND-REMEDIATION-PLAN-3.md`, which set out to merge "13
fragmented selectors". Measuring properly first changed both the count and the
conclusion.

## The audit's 13 was an artifact of shorthand expansion

Round two counted fragments by comparing `[...rule.style]` from the browser —
which **expands shorthands into longhands**. So a rule containing

```css
border: 1px solid var(--border);          /* -> border-top-color, border-right-color, ... */
background: linear-gradient(...);          /* -> background-image, background-position-x, ... */
```

looks like it overlaps a later `border-color:` or `background:` declaration even
though the two blocks declare *different* property names and are simply a
shared base plus an override. Re-measuring by literal property name across all ten
stylesheets finds **1** genuine duplicate, not 13.

The 12 false positives are the idiomatic pattern and are correct as written:

```css
.market-card-icon { background: ...; border-radius: ...; display: grid; ... }
.market-card-icon { font-size: 0.75rem; }   /* later refinement, no property reused */
```

## The one genuine duplicate

`.market-card` declared `background` twice, 388 lines apart:

```css
/* line 116 */
background: linear-gradient(105deg, var(--panel-glass),
                            color-mix(in srgb, var(--panel-glass) 90%, var(--accent) 10%));
/* line 504 */
background: var(--surface);
```

`background` is a shorthand, so the later `var(--surface)` resets every background
longhand — **the gradient never rendered**. It was dead code.

Merged into a single rule at the first block's position, keeping the structural
declarations from block 1 and the winning values from block 2 (`min-height`,
`padding`, `border-color`, `background`, `box-shadow`).

## Proving the gradient was dead

Rather than argue it, the merge was verified two ways against the pre-merge build:

- **Computed styles: `IDENTICAL: no computed-style differences`** across 12
  page/theme/viewport cases (excluding `/pricing/`, which renders a
  non-deterministic async state). If the gradient had been visible anywhere, this
  would have shown `background-image` changing from a gradient to `none`.
- **Geometry: 0 differences** across 8 page/theme/viewport combinations.

## Result

One duplicated property removed, one dead gradient deleted, zero rendered
difference. `noDuplicateProperties` — the rule that expresses exactly this check —
reports nothing across the repository, and it is enabled, so the class of defect
cannot come back unnoticed.
