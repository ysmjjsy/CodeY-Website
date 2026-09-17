# Legacy layout generation merge — 2026-09-17

Stage 2A-3 of `FRONTEND-REMEDIATION-PLAN-3.md`, the highest-risk item in the
plan because the round-two audit initially got it wrong.

## The problem

`market-catalog.css` carried **two generations** of the same two layout rules,
and they did not simply supersede one another — they interleaved at the property
level, with no overlapping property names:

```css
/* generation 1 — sidebar + grid (line 16) */
.market-browser {
  grid-template-columns: 260px minmax(0, 1fr);
  min-height: calc(100vh - 68px);
  margin-inline: auto;
  border-inline: 1px solid var(--border);
  background: var(--surface);
}

/* generation 2 — single column (line 355), overrides only display/width/border */
.market-browser { display: block; width: 100%; border: 0; }
```

Because the two blocks share **no property name**, "the later one wins" is false
as a general statement. Measured on the real page:

| Property | Computed | Status |
|---|---|---|
| `display` | `block` | generation 2 |
| `width` | `1280px` | generation 2 |
| `border-left-width` | `0px` | generation 2 |
| `min-height` | `calc(100vh - 68px)` | **generation 1, still live** |
| `background` | `var(--surface)` | **generation 1, still live** |
| `margin-inline` | `0px` | generation 1, no effect at `width:100%` |
| `grid-template-columns` | `260px minmax(0,1fr)` | generation 1, inert under `display:block` |

So deleting "the old block" would have removed the page's min-height and
background; and leaving both was what made the file confusing to read.

## The merge

```css
.market-browser {
  display: block;
  width: 100%;
  min-height: calc(100vh - 68px);   /* kept: still effective */
  background: var(--surface);        /* kept: still effective */
}                                    /* dropped: grid-template-columns (inert),
                                        border-inline vs border:0 (cancel out),
                                        margin-inline:auto (no effect) */
```

`.market-results` had no overlapping property at all, so generations 1 and 2 were
folded into one block, preserving every declaration.

## Evidence

### 1. Geometry is byte-identical (the decisive test)

A dedicated harness (`/tmp/layout-snapshot.mjs`) captures
`getBoundingClientRect()` for **every element** on 8 page/theme/viewport
combinations — including the three that exercise this rule's media queries
(`/market/` at 1440, 900, 680) and the light theme:

```text
GEOMETRY DIFFERENCES: 0
LAYOUT BYTE-IDENTICAL
```

This is the right test for this change. Computed values *must* change (that is
the point — `grid-template-columns` was a lie in the source), but no pixel may
move, and none does.

### 2. Exactly one computed property changed, and it is the inert one

```text
1 computed-style difference across 1 property
by property:
      1  grid-template-columns
  /market/#dark@1440 section.market-browser
      grid-template-columns: 260px minmax(0px, 1fr) -> none
```

`none` is the honest value for a `display:block` element. No other property on
any page changed, which confirms `min-height` and `background` were carried over
correctly and nothing else was disturbed.

## Result

The marketplace layout is now described by one rule per selector instead of two
interleaved generations, the source no longer claims a grid that does not exist,
and the rendered page is pixel-identical.
