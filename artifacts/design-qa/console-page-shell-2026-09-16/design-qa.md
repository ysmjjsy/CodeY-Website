# Console page shell and locale page deduplication — 2026-09-16

Stage 2C of the frontend remediation plan: remove the duplication between the
zh-CN and en page trees.

## Scope

| Task | Change |
|---|---|
| 2C-1 | Shared page shells: `ConsolePage` / `CommercialPage` / `MarketPage` / `LandingPage` |
| 2C-2 | 14 console pages (7 × `console/*` + 7 × `en/console/*`) now use `ConsolePage` |
| 2C-3 | 14 more pages (index / download / market index / market item / models / pricing / register, both locales) now use a shell |
| 2C-4 | Dynamic `[...locale]/` route evaluated and **rejected**; rationale recorded in `README.md` |

Before this change, each locale tree carried its own copy of the page shell. The
two copies of a pair differed only in `locale` and in a hand-written
`alternateHref`, so they could (and did) drift.

## Comparison target

- Source visual truth: the previous website build, reproduced by checking out
  `HEAD` and running `astro build` on the unmodified tree.
- Browser-rendered implementation: the rebuilt site after the refactor.
- Both states render the same markup; only the page files that assemble the shell
  differ, so the comparison isolates exactly the change under review.

## Evidence

`pages-before.json` / `pages-after.json` record, for all 56 built pages, the
`<title>`, meta description, `<html lang>`, every `hreflang` alternate link, and
`og:locale`.

**Result: all 56 pages are identical on every one of those fields.**

Beyond metadata, the two builds were compared on:

| Dimension | Result |
|---|---|
| Page count | 56 → 56 |
| DOM after removing `<style>`/`<link rel=stylesheet>` and normalizing chunk names | **0 differences across all 56 pages** |
| Referenced asset set (content-hash normalized) | **0 differences** |
| Per-page CSS payload (inline + linked bytes) | **Δ 0 on every page** (`css-payload.txt`) |

`alternateHref` is now derived by `alternateLocalePath(locale, Astro.url.pathname)`
instead of being hand-written per page. This was validated against the pre-change
build: for all 28 localized pages the derived value equals the literal that page
used to hard-code, and the new unit tests cover the round trip.

## Why the dynamic-route option was rejected (2C-4)

`[...locale]/` was implemented and measured rather than assumed. Two blockers:

1. **CSS payload regression.** With a dynamic route, Astro can no longer split
   component CSS per route. A shell that imports every section's component merges
   all of their stylesheets into every console page: `/console/` grew from
   **135,863 to 168,521 bytes** of CSS (+32,658), `/console/models/` by +20,945.
   That is a real cost paid by every visitor, to save 12 small files.
2. **Existing coupling.** Starlight's `locales` configuration and
   `src/middleware.ts`'s locale-cookie logic both depend on the current path
   structure, as the plan anticipated.

Additionally, Astro requires a rest parameter to be the final path segment, so
`[...locale]/console/[section].astro` is not expressible; each section still needs
its own file. The file-count saving was therefore small while the payload cost was
not.

**Conclusion: keep the parallel trees and share the shell** — the option the plan
explicitly allows. The duplicated cost is removed where it actually hurt (the
shell logic) without changing how CSS is delivered.

## Result

- Console page files: 14 × 15 lines → 14 × 10 lines (210 → 140 lines), with the
  shell logic living once in `ConsolePage.astro`.
- The remaining 14 page files (242 lines) assemble only their own content
  component, so Astro keeps splitting CSS per route.
- The four shells are separate rather than one generic shell because they wrap
  four different layouts, each importing a different stylesheet.

## Verification

`pnpm check` (typecheck + astro check + lint + test + build) passes: 0 errors,
24 tests, 56 pages built.
