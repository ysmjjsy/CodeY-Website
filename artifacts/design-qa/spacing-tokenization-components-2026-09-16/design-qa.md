# Component spacing tokenization — 2026-09-16

Stage 2B-10 of the frontend remediation plan: replace the literal `px` values in
`gap`/`padding`/`margin` inside `src/components/*.astro` with the `--space-*` scale.

This is the component-layer half of 2B; `src/styles/*.css` was already tokenized in 2B-3.

## Goal

Every spacing declaration in the component layer resolves through the spacing scale, so a
rhythm change is a token edit rather than a find-and-replace. The substitution must be
**provably value-preserving** — this task deliberately does not re-snap any spacing.

## Scope and method

Only `<style>` blocks are rewritten. Markup and `<script>` bodies are never touched, and the
rewrite is depth-aware:

| Case | Treatment |
|---|---|
| `padding: 24px` | `padding: var(--space-24)` |
| `padding: 24px 16px` | each top-level value tokenized |
| `margin: 16px clamp(16px, 4vw, 24px) 4px` | the outer values only; `clamp()` internals preserved |
| `padding: clamp(14px, 3vw, 20px)` | untouched — plan §2B-10 keeps `clamp()` values |
| `margin: -1px` | untouched — no negative token exists |

## Token scale extension

The numeric scale is documented in `tokens.css` as "覆盖本站历史上出现过的所有间距" (covering every
spacing value that has ever appeared), and `BRAND-TOKENS.md` states the same. Twelve values used
in the component layer were not yet defined, so they were added — **no new abstraction, just the
missing rungs of the existing scale**:

| Added | Added |
|---|---|
| `--space-21` | `--space-50` |
| `--space-27` | `--space-54` |
| `--space-38` | `--space-60` |
| `--space-46` | `--space-112` |
| `--space-116` | `--space-140` |
| `--space-120` | `--space-172` |

## Comparison target

- Baseline: the tree at `4fa1547` (post-2B-9), built to `dist-before`.
- Implementation: the same tree with 2B-10 applied, built to `dist-after`.
- Both served from a static file server, same browser, `deviceScaleFactor: 1`,
  `reducedMotion: reduce`, `colorScheme` forced per capture, and a 4 s settle so the staggered
  `tl-in` entrance animation in `Hero.astro` has finished before the shot.

## Evidence

### 1. Source-level: every changed line is the substitution and nothing else

The strongest proof for a value-preserving refactor is at the source. The diff is 451 removed and
451 added lines; mapping `var(--space-N)` back to `Npx` on each added line reproduces the removed
line **byte-for-byte**:

```text
ALL CHANGED LINES DIFFER ONLY BY Npx -> var(--space-N)
```

There is no second edit hiding in the diff.

### 2. Computed styles: identical across all 12 page/theme/viewport combinations

Using `scripts/style-snapshot.mjs` over its full property set:

```text
IDENTICAL: no computed-style differences
```

Element counts are unchanged on every page, so no declaration was lost or duplicated in a way
that alters layout.

### 3. Pixels: identical on the six compared surfaces

`sharp` full-page raw comparison:

| Surface | Size before → after | Differing bytes |
|---|---|---|
| home dark | 1440×4723 → 1440×4723 | 0 |
| home light | 1440×4723 → 1440×4723 | 0 |
| market dark | 1440×1364 → 1440×1364 | 0 |
| pricing dark | 1440×1144 → 1440×1144 | 0 |
| download dark | 1440×2379 → 1440×2379 | 0 |
| models dark | 1440×1295 → 1440×1295 | 0 |

`*.before.png` / `*.after.png` pairs are stored alongside this file.

> **Note on capture noise.** Two pages (`pricing-light`, `download-light`) can differ by a handful
> of bytes between two captures of the *same* build; the differing region on `/pricing/` is the
> `data-payment-qr` image and on `/download/` a pulsing release element. That noise floor was
> measured by capturing an unchanged build twice, and the six surfaces above were chosen because
> they are stable. The computed-style result (section 2) is deterministic and is the authoritative
> check.

## Result

| Metric | Before | After |
|---|---|---|
| Top-level literal `px` in component spacing declarations | 672 | **0** |
| Component files using `var(--space-*)` | 0 | 22 (all of them) |
| `var(--space-*)` occurrences in components | 0 | 666 |
| Values left literal | — | 38 inside `clamp()`/`calc()`, 6 negative — both per plan |
| New spacing tokens | — | 12 rungs added to the existing numeric scale |

Gate: `pnpm check` green (`typecheck`, `check:astro`, `lint`, `test`, `build:web`).
