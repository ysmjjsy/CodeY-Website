# Residual spacing tokenization — 2026-09-17

Stage 2B-10 cleanup of the frontend remediation plan: tokenize the literal `px`
spacing declarations that the earlier component-layer pass left behind, and
document why the remaining few stay literal.

## Scope

The 2B-9 / 2B-10 passes covered `src/styles/*.css` and most of
`src/components/*.astro`. Re-scanning every `gap` / `padding*` / `margin*` /
`scroll-padding-top` / `scroll-margin-top` declaration across the whole component
and stylesheet tree, ignoring `clamp()` interiors per plan §2B-10, left **13**
literal `px` values. Of those:

| Group | Count | Action |
|---|---|---|
| A matching `--space-N` rung already exists (non-negative) | **11** | Substituted, value-preserving |
| Negative offsets (`-1px`, `-16px`, `-20px`, `-22px`) | 9 occurrences | Retained — the scale defines no negative rungs |
| Positive value with no rung (`104px`, `76px`) | 2 | Retained — documented below |

### Substituted (11 values across 7 files)

| File | Declaration | Token | Rung value |
|---|---|---|---|
| `CloudAdmin.astro` | `padding-block: 6px` | `--space-6` | `6px` |
| `CloudAdmin.astro` | `padding-block: 7px` | `--space-7` | `7px` |
| `CloudAdmin.astro` | `padding-block: 8px` | `--space-8` | `8px` |
| `Download.astro` | `padding-inline: 14px` | `--space-14` | `14px` |
| `MarketDashboard.astro` | `padding-inline: 17px` | `--space-17` | `17px` |
| `ModelsCatalog.astro` | `padding-inline: 8px` | `--space-8` | `8px` |
| `SiteFooter.astro` | `padding-block: 24px` | `--space-24` | `24px` |
| `SiteNav.astro` | `padding-inline: 8px 24px` | `--space-8` + `--space-24` | `8px` / `24px` |
| `SiteNav.astro` | `padding-inline: 8px` | `--space-8` | `8px` |
| `landing.css` | `scroll-padding-top: 88px` | `--space-88` | `88px` |

**No new token was introduced.** Each substitution reuses a rung that
`tokens.css` already defines, and every rung's value equals the literal it
replaced — checked against `tokens.css` rather than assumed. The change is
therefore provably value-preserving, not merely tested.

### Retained: positive values with no rung

| Site | Declaration | Why it stays literal |
|---|---|---|
| `ReleaseHistory.astro:48` | `scroll-margin-top: 104px` | A **geometry-derived** offset for scroll-landing under the sticky header (the scale's neighbours are `--space-96` and `--space-112`; nothing at 104). Snapping to either neighbour would change where the page comes to rest on anchor navigation — a behavioural change, not a rhythm change. |
| `landing.css:140` | `scroll-padding-top: 76px` | The mobile counterpart to the 88px value above, inside `@media (max-width: 640px)`. Neighbours are `--space-72` and `--space-80`; 76px is the deliberate mobile offset. Note the desktop value **was** tokenized (`88px` → `--space-88`) because a rung exists for it; only the 76px one has no rung. |

Both are on the numeric scale's domain — the scale simply has no rung at those
two values, and per plan §2B-3 ("保留确实无对应刻度的值") they are kept.

The asymmetry is deliberate and worth stating: `88px` was tokenized and `76px`
was not, purely because the scale has `--space-88` but no `--space-76`. This is
the scale's stated design — `--space-N` is a numeric rung named for its own pixel
value, so adding `--space-76` would only be justified if 76px were a recurring
spacing choice rather than one geometry-derived offset.

### Retained: negative offsets

`-1px`, `-16px`, `-20px`, and `-22px` appear as `margin`, `margin-inline`, and
`margin-top` values used to bleed a sticky dialog footer, an `sr-only` clip, or a
toast element past its container. `tokens.css` defines no negative rungs by
design — a negative token would invite misuse — so they stay literal. This is
consistent with the earlier 2B pass, which documented `margin: -1px` as untouched
for the same reason.

## Method note: what counts as a literal

The earlier passes replaced whole-value literals (`padding: 24px` →
`var(--space-24)`). This pass closed the remaining gap and, in doing so, corrected
the counting pattern: a looser `: *[0-9]+px` regex had been double-counting
`scroll-padding-*` / `scroll-margin-*` offsets and `clamp()` interiors.

A side effect of scanning properly is that one genuine site the earlier passes
missed was found and fixed here (`landing.css:10`, `88px`), while the two
`scroll-*` values that cannot be snapped are now explicitly documented rather
than silently skipped.

`clamp()` interiors (e.g. `padding-top: clamp(14px, 3vw, 20px)`) remain retained,
as plan §2B-10 prescribes.

## Evidence

Computed-style comparison across the repo's 12 page/theme/viewport cases:

```text
IDENTICAL: no computed-style differences
```

Full output in `computed-style-diff.md`. Because every substituted token resolves
to the exact pixel value it replaced, the zero difference is the expected result
rather than an accident — the value table above is the primary proof, and the
computed-style gate confirms nothing else moved.

Note: the `landing.css:10` change was made after this snapshot pair was captured.
It is a strict rename of `88px` to a token whose value is `88px`, so it cannot
change a computed value; the gate output therefore applies to it as well.

## Final state

| Measure | Result |
|---|---|
| `!important` across `src/` | **0** |
| Literal positive `px` in spacing without a scale rung | **2** (both documented above) |
| Distinct `border-radius` values | 6 tokens + `50%` + 4 documented micro-radii (`1px`, `2px`, `0 3px 3px 0`, `0`) |
| `pnpm check` | exits 0 |
