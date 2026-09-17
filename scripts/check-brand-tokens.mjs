// Policy gate: the cross-repository brand-token contract in BRAND-TOKENS.md.
//
// The two repositories are independent Git checkouts with no shared build, so the
// contract is only real if something checks it. Without this, the values could
// drift apart silently — which is exactly what the round-two audit found: the
// contract document named four shared tokens while only eleven token names were
// common to both repos, and one documented value belonged to the wrong column.
//
// Asserts:
//   1. Every contract name exists in the website's token layer.
//   2. Each contract name resolves to the value it is documented to alias.
//   3. The brand hex values match the desktop's `global.css` character for character.
//   4. Cyan is not used as a brand colour on the website.
//
// Usage: node scripts/check-brand-tokens.mjs
// Exits non-zero on any violation.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const websiteTokens = resolve(projectRoot, 'src/styles/tokens.css')
const desktopStyles = resolve(projectRoot, '../CodeY/apps/desktop/src/shared/styles/global.css')

const problems = []
const fail = (message) => problems.push(message)

/** Extract `--name: value;` declarations from a theme block. */
function declarationsIn(css, blockPattern) {
  const block = blockPattern.exec(css)
  if (!block) return null
  const found = new Map()
  for (const match of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1], match[2].trim())
  }
  return found
}

if (!existsSync(websiteTokens)) fail(`missing ${websiteTokens}`)
if (!existsSync(desktopStyles)) fail(`missing ${desktopStyles}`)

if (problems.length === 0) {
  const website = readFileSync(websiteTokens, 'utf8')
  const desktop = readFileSync(desktopStyles, 'utf8')

  // The website declares dark as the default block and light as an override; the
  // desktop uses `:root` for light and `.dark` for dark.
  const websiteDark = declarationsIn(website, /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)
  const websiteLight = declarationsIn(website, /:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/)
  const desktopLight = declarationsIn(desktop, /\n:root\s*\{([\s\S]*?)\n\}/)
  const desktopDark = declarationsIn(desktop, /\n\.dark\s*\{([\s\S]*?)\n\}/)

  for (const [label, table] of [
    ['website dark block', websiteDark],
    ['website light block', websiteLight],
    ['desktop :root block', desktopLight],
    ['desktop .dark block', desktopDark],
  ]) {
    if (!table) fail(`could not parse the ${label}`)
  }

  if (problems.length === 0) {
    // 1 + 2. Contract names exist and alias what the document says they alias.
    const aliases = [
      ['--primary', '--accent'],
      ['--primary-foreground', '--btn-primary-fg'],
      ['--ring', '--accent'],
      ['--accent-decorative', '--decorative-glow'],
    ]
    for (const [contractName, target] of aliases) {
      for (const [theme, table] of [
        ['dark', websiteDark],
        ['light', websiteLight],
      ]) {
        if (!table.has(contractName)) {
          fail(`website ${theme}: contract token ${contractName} is missing`)
          continue
        }
        const value = table.get(contractName)
        const expected = `var(${target})`
        if (value !== expected) {
          fail(`website ${theme}: ${contractName} is "${value}", expected "${expected}"`)
        }
        if (!table.has(target)) {
          fail(`website ${theme}: ${contractName} aliases ${target}, which is not defined`)
        }
      }
    }

    // The alias target must also exist in the light block when it is theme-varying.
    if (!websiteLight.has('--btn-primary-fg')) {
      fail('website light: --btn-primary-fg is missing (aliased by --primary-foreground)')
    }

    // 3. Brand hex values agree with the desktop source of truth.
    const brandPairs = [
      ['light', websiteLight, desktopLight],
      ['dark', websiteDark, desktopDark],
    ]
    for (const [theme, websiteTable, desktopTable] of brandPairs) {
      const websitePrimary = websiteTable.get('--accent')
      const desktopPrimary = desktopTable.get('--primary')
      // The desktop may define --primary as a literal; if it delegates, resolve one hop.
      let resolved = desktopPrimary
      if (resolved && resolved.startsWith('var(')) {
        const name = resolved.slice(4, -1)
        resolved = desktopTable.get(name)
      }
      if (!websitePrimary) fail(`website ${theme}: --accent is missing`)
      else if (!resolved) fail(`desktop ${theme}: could not resolve --primary`)
      else if (websitePrimary.toLowerCase() !== resolved.toLowerCase()) {
        fail(
          `brand primary mismatch (${theme}): website --accent is ${websitePrimary}, desktop --primary is ${resolved}`,
        )
      }
    }

    // 4. Cyan must not carry brand meaning on the website.
    const brandNames = new Set([
      '--accent',
      '--primary',
      '--ring',
      '--accent-bright',
      '--btn-primary-fg',
    ])
    for (const [theme, table] of [
      ['dark', websiteDark],
      ['light', websiteLight],
    ]) {
      for (const name of brandNames) {
        const value = table.get(name)
        if (!value) continue
        if (/06b6d4|22d3ee|0891b2/i.test(value)) {
          fail(`website ${theme}: ${name} uses cyan (${value}); cyan is decorative only`)
        }
      }
    }
  }
}

if (problems.length === 0) {
  console.log('Brand token contract check passed.')
  process.exit(0)
}

console.error('Brand token contract check failed.\n')
for (const problem of problems) console.error(`- ${problem}`)
console.error(`\n${problems.length} problem(s). See BRAND-TOKENS.md.`)
process.exit(1)
