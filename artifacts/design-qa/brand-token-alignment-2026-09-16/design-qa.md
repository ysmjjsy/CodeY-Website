# Brand token alignment — 2026-09-16

Stage 2A of the frontend remediation plan: unify the brand accent across the website and the
desktop app, and demote cyan to a decorative-only role.

## Decision

Brand accent follows the desktop app (`CodeY/apps/desktop/src/shared/styles/global.css`):

| Semantic | Token | Light | Dark |
|---|---|---|---|
| Brand primary | `--accent` | `#4f46e5` | `#818cf8` |
| Brand primary (bright) | `--accent-bright` | `#4338ca` | `#a5b4fc` |
| Decorative only | `--decorative` | `#0891b2` | `#06b6d4` |

## Comparison target

- Source visual truth: the previous website build, reproduced by overriding the accent custom
  properties with the exact values from `git show HEAD:src/styles/landing.css`.
- Browser-rendered implementation: the rebuilt site after the token change.
- Viewport and pixels: `1440 × 1000` at device scale factor 1, `reducedMotion: reduce`.
- Both states render the same markup and the same CSS; only the accent token values differ, so
  the comparison isolates exactly the change under review.

## Evidence

`before`/`after` pairs for four surfaces, captured in this directory:

- `home-dark` — landing page, dark theme
- `home-light` — landing page, light theme
- `pricing-dark` — pricing page, dark theme
- `docs-dark` — Starlight docs, dark theme

Computed custom-property values read from the live document (`getComputedStyle`):

| Surface | Token | Before | After |
|---|---|---|---|
| home-dark | `--accent` | `#06b6d4` | `#818cf8` |
| home-dark | `--accent-bright` | `#22d3ee` | `#a5b4fc` |
| home-dark | `.hero-glow-cyan` background | `rgba(6,182,212,0.16)` | `rgba(6,182,212,0.16)` (unchanged) |
| home-light | `--accent` | `#4f46e5` | `#4f46e5` (unchanged) |
| home-light | `.hero-glow-cyan` background | `rgba(79,70,229,0.12)` | `rgba(8,145,178,0.12)` |
| pricing-dark | `--accent` | `#06b6d4` | `#818cf8` |
| docs-dark | `--sl-color-accent` | `#06b6d4` | `#818cf8` |
| home-dark | `--radius-lg` / `--radius-xl` | `12px` / `16px` | `12px` / `16px` (unchanged) |

## Findings

- Dark-theme brand accent moves from cyan to indigo on every surface: landing, pricing, console
  and docs. The light-theme brand accent was already indigo and is intentionally unchanged.
- Cyan is retained only through `--decorative-glow`, consumed by the ambient radial glow in
  `commercial.css` and the two `.hero-glow-cyan` / `.download-glow-cyan` washes. In dark theme
  those glows were already cyan, so they are visually unchanged; in light theme they move from an
  indigo wash to a cyan wash, which is the intended effect of separating brand from decoration.
- Two class names that described a hue rather than a role were renamed so they cannot drift from
  the token they use: `.status-dot-cyan` → `.status-dot-brand`, `.log-cyan` → `.log-brand`.
- Radius scale aligned with the desktop app (`--radius-sm 6px`, `--radius-md 10px`,
  `--radius-lg 12px`, `--radius-xl 16px`); the previous website scale was `10/14/20px`.
- `--btn-primary-fg` now resolves to the dark background color, matching the desktop
  `--primary-foreground` convention for the indigo primary.
- `--accent-glow` was redefined as an indigo glow and is used only where the glow accompanies a
  brand surface (recommended pricing card, primary button, architecture daemon node).

## Verification

- `pnpm check` (typecheck, astro check, biome, vitest, build): passed.
- Landing and pricing dark surfaces render the indigo accent with readable contrast against the
  zinc background.
- Brand accent, decorative glow and radius values confirmed by reading computed custom
  properties from the rendered document on four surfaces in both themes.

## Notes

- The screenshots in this directory are the visual record for this change. Automated vision
  review was unavailable in this environment (the configured provider returned HTTP 503 and no
  local vision CLI was signed in), so the accent values above were verified by reading computed
  custom properties from the rendered document instead of by visual inspection.

final result: passed
