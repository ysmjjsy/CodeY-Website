// Computed-style regression harness for the website.
//
// Captures a fingerprint of every element's layout-affecting computed styles on a
// set of pages, so a CSS refactor can be proven visually inert (or the exact
// differences reviewed) instead of eyeballed.
//
// Usage:  node style-snapshot.mjs <base-url> <out.json>
//
// Playwright is not a website dependency; this dev-only tool borrows it from the
// desktop app. Override with PLAYWRIGHT_ENTRY if your checkout layout differs.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

function resolvePlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_ENTRY,
    '@playwright/test',
    path.resolve(process.cwd(), '../CodeY/apps/desktop/node_modules/@playwright/test/index.js'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'Could not resolve @playwright/test. Set PLAYWRIGHT_ENTRY to its index.js, or run this from a checkout that has the desktop app installed.',
  )
}

const { chromium } = resolvePlaywright()

const EXE =
  process.env.PLAYWRIGHT_CHROMIUM ||
  '/Users/goya/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const BASE = process.argv[2] || 'http://127.0.0.1:4501'
const OUT = process.argv[3] || '/tmp/vis/snapshot.json'

const PAGES = [
  ['/', 'dark', 1440],
  ['/', 'light', 1440],
  ['/market/', 'dark', 1440],
  ['/market/', 'dark', 1180],
  ['/market/', 'dark', 900],
  ['/market/', 'dark', 680],
  ['/pricing/', 'dark', 1440],
  ['/download/', 'dark', 1440],
  ['/console/', 'dark', 1440],
  ['/models/', 'dark', 1440],
  ['/docs/intro/', 'dark', 1440],
  ['/docs/intro/', 'light', 1440],
]

// Properties whose computed value must not change in a pure refactor.
const PROPS = [
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'row-gap',
  'column-gap',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'font-size',
  'line-height',
  'color',
  'background-color',
  'border-top-color',
  'color-scheme',
  'display',
  'width',
  'height',
  'grid-template-columns',
  'flex-direction',
  'gap',
  'position',
  'inset',
]

const browser = await chromium.launch({ executablePath: EXE })
const result = {}

for (const [path, theme, width] of PAGES) {
  const ctx = await browser.newContext({
    viewport: { width, height: 1000 },
    colorScheme: theme,
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t
  }, theme)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(200)

  const entries = await page.evaluate((props) => {
    const out = []
    const walk = (el, index) => {
      const cs = getComputedStyle(el)
      const style = {}
      for (const p of props) style[p] = cs.getPropertyValue(p)
      // Identify an element by its DOM path plus classes, which is stable across
      // a CSS-only refactor.
      out.push({
        path: index,
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className : '',
        style,
      })
      let i = 0
      for (const child of el.children) walk(child, `${index}.${i++}`)
    }
    walk(document.body, '0')
    return out
  }, PROPS)

  result[`${path}#${theme}@${width}`] = entries
  await ctx.close()
  console.log('captured', path, theme, width, entries.length, 'elements')
}

await browser.close()
fs.writeFileSync(OUT, JSON.stringify(result, null, 1))
console.log('wrote', OUT)
