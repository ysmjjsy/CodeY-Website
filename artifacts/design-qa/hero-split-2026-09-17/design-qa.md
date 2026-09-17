# Hero component split — 2026-09-17

Stage 3D-1a of the frontend remediation plan: split the `Hero.astro` giant
component.

## Scope

| Before | After |
|---|---|
| `src/components/Hero.astro` — 601 lines (119 markup + 482 scoped `<style>`) | `src/components/Hero.astro` — 157 lines (the hero shell: background, copy column, and the 10 rules that style them) |
| — | `src/components/HeroVisual.astro` — 447 lines (the product-window mock and the 46 rules that style it) |

`Hero` was the one giant component whose bulk is **CSS, not script** — it has no
`<script>` block at all. It was therefore split along the visual seam the markup
already had: everything inside `<div class="hero-visual">` moved into a new
`HeroVisual` component, taking only the CSS rules that target it.

## The split seam

The markup boundary was already explicit — the visual region was a single
`<div class="hero-visual" aria-hidden="true">…</div>`. The CSS boundary had to be
computed rather than guessed, so it was done with a brace-depth-aware parser
rather than by eye.

Each top-level CSS unit (a rule, or an `@media` block whose inner rules were
split individually) was assigned by its **leading selector**:

| Group | Selectors |
|---|---|
| Stays in `Hero` | `.hero`, `.hero-bg`, `.hero-grid`, `.hero-badge`, `.badge-dot`, `.hero-title`, `.hero-title-accent`, `.hero-sub`, `.hero-actions`, `.hero-meta` |
| Moves to `HeroVisual` | `.hero-visual`, `.hero-window`, `.win-*`, `.status-dot*`, `.pulse`, `.side-icon*`, `.task-*`, `.timeline`, `.tl-*`, `.diff-*`, `.perm-*`, `.caret`, `.hero-glow*`, and the three `@keyframes` |

Both `@media` blocks were split the same way: their `max-width: 920px` and
`max-width: 640px` blocks each kept their `.hero` / `.hero-grid` rules in `Hero`
and moved their `.win-*` / `.tl-*` / `.perm-*` / `.hero-glow-*` rules to
`HeroVisual`, each emitting its own `@media` wrapper.

## Why the split is provably visual-inert

A scoped-CSS split is riskier than a script extraction: Astro rewrites each
component's `<style>` into a hash-suffixed scope, so moving rules between
components changes *which* hash selects them. The split was therefore verified by
computed style, not by reasoning.

The partition itself was checked first: re-scanning both output files found
**57 / 57 selectors** and **154 / 154 declarations** identical to the original,
with none missing and none extra.

### 1. Screenshots are pixel-identical

| Capture | Result |
|---|---|
| `home-1440` (dark, 1440px) | SHA-256 **identical** |
| `home-390` (dark, 390px) | SHA-256 **identical** |
| `home-1440-light` (light, 1440px) | SHA-256 **identical** |

### 2. Computed styles are identical on the standard page set

`scripts/style-diff.mjs` over the repo's own 12-case snapshot set (12 page × theme
× viewport combinations, 30 layout-affecting properties per element):

```text
IDENTICAL: no computed-style differences
```

### 3. Computed styles are identical across every Hero breakpoint

The stock harness only snapshots `/` at 1440px, which would miss both of Hero's
media queries. Because `Hero` has `@media (max-width: 920px)` and
`@media (max-width: 640px)`, the home page was re-captured at **9 widths
(1440 / 1000 / 920 / 919 / 800 / 641 / 640 / 480 / 390) × 2 themes = 18 cases**,
bracketing each breakpoint from both sides, over 31 properties including
`grid-template-columns`, `gap`, `padding-*`, `display`, `order`, `inset`,
`mask-image`, and `filter`.

```text
IDENTICAL: no computed-style differences
```

### Why a second scope hash appears — and why it is harmless

The built home page previously carried one scope class in the hero subtree
(`astro-ge2uvauf`); now the visual subtree carries `astro-i3xutpoc` as well.
This is expected: `HeroVisual` is a separate component, so Astro gives it its own
hash and the *child component's own* markup emits `astro-i3xutpoc`. The rules
that moved went with it, so selector and target still match.

The `Hero`-owned hash is not lost on the moved subtree, and no rule needs two
hashes. Astro emits each scoped selector as `selector:where(.astro-HASH)`, for
example:

```css
.hero-visual:where(.astro-i3xutpoc){position:relative}
.hero-window:where(.astro-i3xutpoc){…}
```

Because `:where()` contributes zero specificity, the moved rules are ordinary
class selectors matched against the elements that now carry `astro-i3xutpoc`.
The parent's `astro-ge2uvauf` no longer needs to match them, because the rules
that referenced the parent's hash (`.hero`, `.hero-grid`, …) did not move. The
three checks above confirm every element still computes to the same value.

## Verification

| Gate | Result |
|---|---|
| `pnpm lint` (Biome) | pass — 0 errors |
| `pnpm typecheck` (`tsc --noEmit`) | pass |
| `pnpm check:astro` | pass — 0 errors, 0 warnings |
| `pnpm test` (Vitest) | pass |
| `pnpm build:web` | pass — 56 pages built |

`pnpm check` (the aggregate gate) exits 0.

## Final result

`Hero.astro` drops from 601 to 157 lines; the window mock now lives in
`HeroVisual.astro`, which composes with it through a single `locale` prop. The
split is proven inert by pixel-identical screenshots at three viewports and by
zero computed-style differences across 30 page/theme/viewport cases that
explicitly cover both of the component's media-query breakpoints.
