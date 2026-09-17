# AGENTS.md — src/

The Astro site source for the CodeY marketing pages, the marketplace/console/cloud
UI, and the Starlight documentation content. Everything user-visible in this
repository is built from here.

## Responsibilities

- Route the marketing, market, console, download, models, pricing and register pages for both locales.
- Define the single design-token layer (`src/styles/tokens.css`) and the page stylesheets layered on it.
- Own the Astro components and the layouts that compose them.
- Hold all UI-facing strings in `src/i18n/` and all locale path construction in `src/i18n/utils.ts`.
- Carry the browser-side data code for the market dashboard, cloud admin, downloads and pagination.
- Hold the published Starlight docs under `src/content/docs/` (Chinese default plus `en/`).

## Boundaries

- Do not define a colour, radius, spacing or font literal outside `src/styles/tokens.css`; stylesheets consume `var(--*)`.
- Do not write a literal rem `font-size` — use the `--text-*` scale or `clamp()`. `scripts/check-font-sizes.mjs` fails on literals.
- Do not introduce a media-query width outside the frozen set in `scripts/check-breakpoints.mjs`.
- Do not hardcode UI strings in a component; add them to `src/i18n/` so both locales stay in parity.
- Do not hand-write alternate-locale hrefs; derive them with `alternateLocalePath()`.
- Do not put build output here; `dist/` is generated and gitignored.

## Key paths

| Path | What it does |
| --- | --- |
| `src/pages/` | Astro routes; zh-CN is unprefixed and every route has an `/en/` mirror |
| `src/components/` | Page sections and client-facing widgets (`MarketCatalog`, `CloudAdmin`, `SiteNav`, …) |
| `src/components/ui/` | Presentational primitives (`Button`, `Panel`, `Dialog`, `Pagination`, …) |
| `src/layouts/` | `LandingLayout` (HTML shell, theme + locale boot scripts, reveal observer), `MarketLayout`, `CommercialLayout` |
| `src/styles/tokens.css` | The only token definition site: dark default block, light override, brand aliases |
| `src/styles/landing.css` | Landing layout styles; opens with `@import "./tokens.css"` |
| `src/styles/starlight.css` | Starlight `customCss` entry; imports tokens itself because it bypasses the layouts |
| `src/styles/ui.css`, `commercial.css`, `console.css`, `market-*.css` | Per-surface stylesheets, imported by their layout or shell |
| `src/i18n/ui.ts` | `locales`, `Locale`, `defaultLocale`, the `ui` table and the `UiKey` type |
| `src/i18n/utils.ts` | `t()` plus the per-surface path builders, including `alternateLocalePath()` |
| `src/lib/` | `market-dashboard.ts`, `cloud-admin.ts`, `download.ts`, `pagination.ts`, `toast.ts`, `provider-presets.ts` |
| `src/content/docs/` | Starlight docs (default zh) and the mirrored `src/content/docs/en/` tree |
| `src/content.config.ts` | The `docs` collection, loaded by `docsLoader()` with `docsSchema()` |
| `src/middleware.ts` | `codey-locale` cookie sync and `/` → `/en/` redirect for SSR/preview |
| `astro.config.mjs` | `starlight()` integration: locales, sidebar, and `customCss` (two fonts plus `starlight.css`) |

## Commands / Verification

- `pnpm dev` / `pnpm start` — dev server and production server; both also run the market API.
- `pnpm test` — Vitest over colocated `src/**/*.test.ts` in a jsdom environment.
- `pnpm typecheck`, `pnpm check:astro`, `pnpm lint` — TypeScript, Astro templates, Biome.
- Both stylesheet halves are gated: `pnpm lint` covers `src/styles/*.css`, while `pnpm check:styles` covers the 24 `<style>` blocks inside `.astro` files that Biome does not parse.
- `pnpm check` is the single aggregator CI runs; do not add a CI step list that can drift.
