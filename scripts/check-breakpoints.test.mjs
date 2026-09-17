// Negative tests for `check-breakpoints.mjs`.
//
// Run: node scripts/check-breakpoints.test.mjs

import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

const PROBE = 'src/styles/__BreakpointProbe.css'

const cases = [
  {
    name: 'documented breakpoint passes',
    body: '@media (max-width: 900px) {\n  .a {\n    display: block;\n  }\n}\n',
    expect: null,
  },
  {
    name: 'undocumented breakpoint is caught',
    body: '@media (max-width: 903px) {\n  .a {\n    display: block;\n  }\n}\n',
    expect: /undocumented 903px/,
  },
  {
    name: 'max-width outside a media query is ignored',
    body: '.a {\n  max-width: 903px;\n}\n',
    expect: null,
  },
  {
    name: 'min-width is checked too',
    body: '@media (min-width: 903px) {\n  .a {\n    display: block;\n  }\n}\n',
    expect: /undocumented 903px/,
  },
]

let failures = 0
try {
  for (const testCase of cases) {
    writeFileSync(PROBE, testCase.body)
    const result = spawnSync(process.execPath, ['scripts/check-breakpoints.mjs'], {
      encoding: 'utf8',
    })
    const output = `${result.stdout || ''}${result.stderr || ''}`
    const failed = result.status !== 0
    const ok = testCase.expect === null ? !failed : failed && testCase.expect.test(output)
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`)
    if (!ok) {
      failures++
      console.log(
        `      status=${result.status} output=${output.split('\n').filter(Boolean).slice(0, 3).join(' | ')}`,
      )
    }
  }
} finally {
  rmSync(PROBE, { force: true })
}

// The reduced-motion guard is a correctness property, not a style preference:
// both stylesheet entry points must carry it. `landing.css` serves the marketing,
// market and commercial layouts; `starlight.css` serves the docs site and is loaded
// independently, so it needs its own.
for (const file of ['src/styles/landing.css', 'src/styles/starlight.css']) {
  const css = readFileSync(file, 'utf8')
  const hasGuard = css.includes('@media (prefers-reduced-motion: reduce)')
  const neutralisesMotion =
    /animation-duration:\s*0?\.001ms/.test(css) && /transition-duration:\s*0?\.001ms/.test(css)
  const ok = hasGuard && neutralisesMotion
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file} has a reduced-motion guard`)
  if (!ok) failures++
}

console.log(failures === 0 ? '\nALL BREAKPOINT TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
