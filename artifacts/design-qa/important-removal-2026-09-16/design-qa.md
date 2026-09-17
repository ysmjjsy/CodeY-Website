# `!important` removal — 2026-09-16

Stage 2B-8 of the frontend remediation plan: remove every `!important` from the website
components. The plan counted 7; the working tree had 8 (the plan's count missed one of the two
`CloudAdmin` declarations on the label rule).

## Goal

`grep -rc "!important" src/` must be zero, with no visual change.

## Sites and the rule each one was fighting

Each conflict was identified by walking `document.styleSheets` in the browser and listing every
rule that actually matched the element and set the property, in cascade order.

| # | Site | Property | Competing rule | Resolution |
|---|---|---|---|---|
| 1 | `CloudAdmin.astro` `.capability-grid label` | `display`, `color`, `gap` | `.model-config-editor label:not(.setting-toggle)` (0,2,1) | scope to `.model-config-editor .capability-grid label` (0,3,1), later in source |
| 2 | `CloudAdmin.astro` `.capability-grid input` | `width`, `min-height`, `padding` | none — the generic input rule excludes `[type='checkbox']` | `!important` was unnecessary; dropped |
| 3 | `MarketDashboard.astro` `[hidden]` | `display` | `.btn { display: inline-flex }`, `.console-admin-navigation { display: grid }` | `[hidden][hidden]` (0,2,0), matching the idiom already in `src/styles/market-shared.css` |
| 4 | `SdkSection.astro` `.code-panel pre` | `background` | Shiki writes `background-color` as an **inline style**, which no selector can outrank | strip only the background declaration with a Shiki `pre` transformer; the theme foreground and token colours are untouched |
| 5 | `UserAdmin.astro` `.user-date` | `color` | `.user-table td` (0,1,1) | `.user-table .user-date` (0,2,0) |
| 6 | `SiteNav.astro` `.nav-links .nav-cta` | `border-top`, `padding` | `.nav-links a` (0,1,1) | `.nav-links .nav-cta` is already (0,2,0) and later in source; `!important` was redundant |

`src/styles/landing.css:122` also contains the string, but only inside a comment explaining why
the reduced-motion block uses `:root:root *` instead of `!important`. That comment is retained.

## Evidence

Method: two full production builds served side by side — `dist-before` from the working tree with
the five component files stashed, and `dist-after` with the fixes applied. Same browser, same
viewports, `reducedMotion: reduce`.

1. **Byte-identical screenshots.** `*.before.png` / `*.after.png` pairs for the five affected
   surfaces (`cmp` reports identical for all five):

   | Surface | Viewport |
   |---|---|
   | `/console/plans/` | 1440 |
   | `/console/users/` | 1440 |
   | `/console/templates/` | 1440 |
   | `/` | 1440 |
   | `/` (mobile nav open) | 390 |

2. **Identical computed styles.** Every property at every changed site resolves to the same value
   before and after — 12 selector/property groups, 0 differences. Includes the `.user-date` cell,
   which is injected after auth: a representative row was added to the live table so the cascade
   could be read directly.

   The `.user-date` cascade before and after, from the live document:

   ```text
   BEFORE: .user-table td -> var(--fg-muted) ; !.user-date -> var(--fg-faint)
   AFTER : .user-table td -> var(--fg-muted) ;  .user-table .user-date -> var(--fg-faint)
   ```

   Computed colour is `rgb(113, 113, 122)` in both.

3. **Regression harness.** `scripts/style-snapshot.mjs` over its 12 page/theme/viewport
   combinations: 0 property differences.

## Result

`grep -rn "!important" src/` returns **0** hits: no stylesheet rule uses the flag, and the
explanatory comments that used to quote it were reworded to describe the specificity argument
instead, so the plan's literal verification (`grep -c "!important"`归零) holds.

Final gate: `pnpm check` green — `typecheck`, `check:astro`, `lint`, `test`, `build:web`.
