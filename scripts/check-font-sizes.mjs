// Policy gate: no literal font sizes may appear in CSS.
//
// `tokens.css` defines an eleven-rung `--text-*` scale. Before it existed the site
// carried 92 distinct `font-size` values, many differing by 0.01rem (0.16px) —
// below one physical pixel, so the distinctions were invisible but maintained. A
// scale only stays meaningful if literals cannot creep back, hence this check.
//
// It covers both places styles live, because Biome does not parse `<style>` blocks
// inside `.astro` files:
//   - `src/styles/*.css`
//   - `<style>` blocks in `src/**/*.astro`
//
// `clamp()` is exempt: fluid display type interpolates between two bounds and is
// deliberately not snapped to a rung. Non-rem units (`em`, `%`, `px`) are exempt
// for the same reason — the scale is defined in rem.
//
// Usage: node scripts/check-font-sizes.mjs
// Exits non-zero when a literal rem font size is found.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function collectFiles(directory, suffix) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...collectFiles(full, suffix))
    else if (entry.name.endsWith(suffix)) found.push(full)
  }
  return found.sort()
}

/**
 * Produce `{ text, lineOffset }` segments for a file.
 *
 * For `.css` the whole file is one segment starting at line 1. For `.astro` each
 * `<style>` block is its own segment, carrying the line number its CSS starts on
 * so reported lines point into the `.astro` source rather than into a
 * concatenation of blocks.
 */
function styleSegmentsOf(file, source) {
  if (file.endsWith('.css')) return [{ text: source, lineOffset: 0 }]
  const segments = []
  for (const match of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const before = source.slice(0, match.index)
    const openTagLines = match[0].slice(0, match[0].indexOf('>') + 1).split('\n').length
    // `tagStartLine` is the 1-based line the `<style` tag begins on. The body's first
    // split segment is the remainder of the tag's own last line, so segment index `i`
    // sits on file line `tagStartLine + openTagLines - 1 + i`. Reporting uses
    // `lineOffset + i + 1`, hence the `- 2` here.
    const tagStartLine = before.split('\n').length
    const lineOffset = tagStartLine + openTagLines - 2
    segments.push({ text: match[1], lineOffset })
  }
  return segments
}

const LITERAL_FONT_SIZE = /font-size\s*:\s*([^;{}]+)/g
const LITERAL_FONT_SHORTHAND_SIZE = /font\s*:\s*([^;{}]+)/g

const problems = []

for (const file of [
  ...collectFiles(resolve(projectRoot, 'src/styles'), '.css'),
  ...collectFiles(resolve(projectRoot, 'src'), '.astro'),
]) {
  const relativePath = relative(projectRoot, file)

  for (const segment of styleSegmentsOf(file, readFileSync(file, 'utf8'))) {
    // Walk line by line so a declaration split across lines still reports its
    // starting line, and so the line offset stays meaningful.
    const lines = segment.text.split('\n')
    lines.forEach((line, index) => {
      const check = (declaration, value) => {
        if (!/(\d|\.)\s*rem/.test(value)) return
        if (value.includes('clamp(')) return
        if (value.includes('var(--text-')) return
        problems.push({
          file: relativePath,
          line: segment.lineOffset + index + 1,
          declaration,
          value: value.replace(/\s+/g, ' ').trim(),
        })
      }
      for (const match of line.matchAll(LITERAL_FONT_SIZE)) check('font-size', match[1])
      for (const match of line.matchAll(LITERAL_FONT_SHORTHAND_SIZE)) check('font', match[1])
    })
  }
}

if (problems.length === 0) {
  console.log('Font size check passed (no literal rem font sizes).')
  process.exit(0)
}

console.error('Font size check failed.\n')
console.error(
  'Use a `--text-*` token from src/styles/tokens.css, or `clamp()` for fluid display type.\n',
)
for (const problem of problems) {
  console.error(`- ${problem.file}:${problem.line} ${problem.declaration}: ${problem.value}`)
}
console.error(`\n${problems.length} literal font size(s).`)
process.exit(1)
