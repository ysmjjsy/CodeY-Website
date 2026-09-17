# Computed-style gate output — 2B residual spacing tokenization (2026-09-17)

Twelve page/theme/viewport cases from `scripts/style-snapshot.mjs`, comparing the
tree before the substitution with the tree after it.

```text
$ node scripts/style-diff.mjs 2b-before.json 2b-after.json
IDENTICAL: no computed-style differences
exit 0
```

Every substituted token resolves to the exact pixel value it replaced, so a zero
difference here is the expected result rather than a lucky one:

| Token | Value | Replaced literal |
|---|---|---|
| `--space-6` | `6px` | `6px` |
| `--space-7` | `7px` | `7px` |
| `--space-8` | `8px` | `8px` |
| `--space-14` | `14px` | `14px` |
| `--space-17` | `17px` | `17px` |
| `--space-24` | `24px` | `24px` |
