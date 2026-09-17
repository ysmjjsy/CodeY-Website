// Policy gate: responsive breakpoints come from a documented set.
//
// CSS custom properties cannot be used in a media query condition — the spec does
// not expand `var()` there — so breakpoints are the one part of the design system
// that cannot be tokenised. The alternative is to freeze the permitted set and
// document it, so the count stops growing one screen size at a time.
//
// The set below is the consolidated value of what the site already uses, grouped
// where two widths were within 20px of each other and served the same intent.
// Widening or replacing an entry is a deliberate act that must edit both this file
// and the CONTRIBUTING.md table.
//
// Usage: node scripts/check-breakpoints.mjs
// Exits non-zero on an undocumented breakpoint.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The permitted breakpoints, with the intent each one carries.
 * Keep in sync with the table in CONTRIBUTING.md.
 *
 * This is the set the site already uses, frozen rather than reinvented. Seventeen
 * widths is more than a fresh design would choose, but *collapsing* them is a
 * behaviour change, not a cleanup: merging 620 into 640 would apply the 620px rules
 * across 621-639px as well, altering the layout in that band. That is a design
 * decision requiring its own before/after evidence, so this gate freezes what
 * exists and stops the count growing while that decision is made deliberately.
 */
export const BREAKPOINTS = {
  420: 'narrow phone',
  480: 'phone',
  520: 'large phone',
  560: 'phone landscape',
  600: 'small phablet',
  620: 'phablet',
  640: 'large phablet',
  680: 'small tablet',
  720: 'tablet portrait',
  760: 'tablet',
  820: 'large tablet',
  900: 'small laptop',
  920: 'laptop',
  960: 'laptop wide',
  980: 'small desktop',
  1050: 'desktop',
  1180: 'wide desktop',
}

function collectFiles(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...collectFiles(full))
    else if (entry.name.endsWith('.css') || entry.name.endsWith('.astro')) found.push(full)
  }
  return found.sort()
}

const problems = []
const permitted = new Set(Object.keys(BREAKPOINTS).map(Number))

for (const file of collectFiles(resolve(projectRoot, 'src'))) {
  const source = readFileSync(file, 'utf8')
  const lines = source.split('\n')
  lines.forEach((line, index) => {
    // Only media query conditions, not `max-width` used for layout.
    if (!line.includes('@media')) return
    for (const match of line.matchAll(/(?:max|min)-width:\s*(\d+)px/g)) {
      const width = Number(match[1])
      if (!permitted.has(width)) {
        problems.push({
          file: relative(projectRoot, file),
          line: index + 1,
          width,
          text: line.trim(),
        })
      }
    }
  })
}

if (problems.length === 0) {
  const used = new Set()
  for (const file of collectFiles(resolve(projectRoot, 'src'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(
      /@media[^{]*(?:max|min)-width:\s*(\d+)px/g,
    )) {
      used.add(Number(match[1]))
    }
  }
  const unused = [...permitted].filter((w) => !used.has(w))
  console.log(`Breakpoint check passed (${used.size} documented widths in use).`)
  if (unused.length > 0) console.log(`  unused entries still documented: ${unused.join(', ')}`)
  process.exit(0)
}

console.error('Breakpoint check failed.\n')
console.error('Permitted widths:', [...permitted].sort((a, b) => a - b).join(', '))
console.error('See the breakpoint table in CONTRIBUTING.md.\n')
for (const problem of problems) {
  console.error(
    `- ${problem.file}:${problem.line} undocumented ${problem.width}px — ${problem.text}`,
  )
}
console.error(`\n${problems.length} undocumented breakpoint(s).`)
process.exit(1)
