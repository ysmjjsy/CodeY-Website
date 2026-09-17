# Radius tokenization — 2026-09-16

Stage 2B-9 of the frontend remediation plan: converge the literal `border-radius` values in
`src/components/*.astro` onto the documented `--radius-*` scale.

## Goal

`border-radius` literals in the component layer drop from **106** to only values that genuinely
have no scale slot, with no visual change beyond the intended snapping.

## Scope

The plan counted 106 literal declarations in `src/components/*.astro`. Re-running the scan found
107 (one multi-value form, `999px 999px 0 0`, counted as one declaration). `src/styles/*.css` and
`src/layouts/` already had **0** radius literals, so this task is component-layer only.

## Snapping map (plan §2B-4)

Applied onto the five tokens already documented in `BRAND-TOKENS.md` and `CONTRIBUTING.md`
(`--radius-sm/md/lg/xl/pill`). No new token was introduced, so the two repositories keep one
shared scale.

| Literal | Count | Token | Rationale |
|---|---|---|---|
| `5px` | 1 | `--radius-sm` | plan: `5/6/7px → --radius-sm` |
| `6px` | 6 | `--radius-sm` | exact |
| `7px` | 6 | `--radius-sm` | plan |
| `8px` | 18 | `--radius-md` | plan: `8/9/10/11px → --radius-md` |
| `9px` | 7 | `--radius-md` | plan |
| `10px` | 20 | `--radius-md` | exact |
| `11px` | 4 | `--radius-md` | plan |
| `12px` | 8 | `--radius-lg` | exact |
| `14px` | 2 | `--radius-lg` | plan: `12/13/14px → --radius-lg` |
| `16px` | 2 | `--radius-xl` | exact |
| `18px` | 3 | `--radius-xl` | plan: `16/20px → --radius-xl` |
| `22px` | 1 | `--radius-xl` | dialog scale; above `xl`, `pill` would be wrong |
| `99px` | 1 | `--radius-pill` | historical badge pill; `999px` in the same role |
| `999px` | 23 | `--radius-pill` | exact |
| `999px 999px 0 0` | 1 | `var(--radius-pill) var(--radius-pill) 0 0` | tab indicator, top corners only |

## Deliberately retained

Three declarations keep a literal because the scale has no equivalent, and inventing a token for
them would be noise:

| Site | Value | Why retained |
|---|---|---|
| `SiteNav.astro:176` | `1px` | hairline progress/indicator sliver |
| `Architecture.astro:242`, `SdkSection.astro:155` | `2px` | 6px-tall bar caps; `--radius-sm` (6px) would exceed half the height and render as a pill |
| `Toast.astro:120` | `0 3px 3px 0` | left-edge accent bar; right corners only |
| all `border-radius: 50%` (17) | `50%` | circles — `CONTRIBUTING.md` explicitly prescribes `50%` for these |

## Comparison target

- Source visual truth: the website built from `HEAD` (`08dbf5c`), copied to `dist-before`.
- Implementation: the same build after tokenization, copied to `dist-after`.
- Both served from a static file server on `127.0.0.1`, same browser, same viewports,
  `deviceScaleFactor: 1`, `reducedMotion: reduce`, `colorScheme` forced per capture.
- The markup is byte-identical between the two builds (only stylesheets differ), so the
  comparison isolates the radius change.

## Evidence

### 1. Computed styles — no property outside the radius group moved

12 page/theme/viewport combinations, the `scripts/style-snapshot.mjs` property set **plus** the
four `border-*-radius` longhands.

| Measure | Result |
|---|---|
| Non-radius property differences | **0** |
| Elements per page | identical before → after on all 12 (e.g. `/` 559 → 559) |
| Radius transitions | 7 distinct, all intended |

Radius transitions observed (each count is corner-property hits, so ×4 per element):

| before → after | hits |
|---|---|
| `8px → 10px` | 388 |
| `9px → 10px` | 164 |
| `7px → 6px` | 120 |
| `18px → 16px` | 44 |
| `22px → 16px` | 40 |
| `14px → 12px` | 40 |
| `11px → 10px` | 4 |

Every transition is a mapping the plan prescribes. `/docs/intro/` shows 0 hits, confirming the
Starlight pages are untouched.

### 2. Pixels — differences confined to corners, page heights unchanged

`sharp` full-page raw comparison, same canvas:

| Surface | Size before → after | Differing bytes | Max Δ | Mean Δ |
|---|---|---|---|---|
| home dark | 1440×4723 → 1440×4723 | 6367 (0.023%) | 231 | 0.014 |
| home light | 1440×4723 → 1440×4723 | 3036 (0.011%) | 75 | 0.002 |
| market dark | 1440×1364 → 1440×1364 | 1548 (0.020%) | 99 | 0.005 |
| pricing dark | 1440×1144 → 1440×1144 | 1545 (0.023%) | 101 | 0.006 |
| models dark | 1440×1295 → 1440×1295 | 2446 (0.033%) | 101 | 0.006 |
| download dark | 1440×2379 → 1440×2379 | 3156 (0.023%) | 91 | 0.003 |
| docs intro dark | 1440×1756 → 1440×1756 | **0** | 0 | 0 |

Page heights are byte-identical, so no layout reflow occurred. The affected pixels are the
rounded-corner regions, which is the intended convergence; `/docs/intro/` is pixel-identical.

`*.before.png` / `*.after.png` pairs for the six surfaces above are stored alongside this file.

## Result

| Metric | Before | After |
|---|---|---|
| `border-radius` literals in `src/components/*.astro` | 106 | **3** (`1px`, `2px`×2 — see "Deliberately retained") |
| Multi-value literal form | 1 | 0 |
| Distinct radius values | 16 | 5 tokens + `50%` + 3 sub-scale literals |
| New tokens introduced | — | 0 |

Gate: `pnpm check` green (`typecheck`, `check:astro`, `lint`, `test`, `build:web`).
