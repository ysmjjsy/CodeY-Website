# Computed-style gate output — Hero split (2026-09-17)

## Desktop/standard page set (`scripts/style-snapshot.mjs`, 12 page·theme·viewport cases)

```
$ node scripts/style-diff.mjs hero-before-snapshot.json hero-after-snapshot.json
IDENTICAL: no computed-style differences
exit 0
```

## Home page across every Hero breakpoint (9 widths x 2 themes = 18 cases)

Widths 1440 / 1000 / 920 / 919 / 800 / 641 / 640 / 480 / 390 bracket both
`@media (max-width: 920px)` and `@media (max-width: 640px)`, plus 30 properties
including `grid-template-columns`, `gap`, `padding-*`, `display`, `order`,
`inset`, `mask-image`, and `filter`.

```
$ node scripts/style-diff.mjs hero-mobile-before.json hero-mobile-after.json
IDENTICAL: no computed-style differences
exit 0
```
