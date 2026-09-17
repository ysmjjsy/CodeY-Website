// Negative tests for `check-font-sizes.mjs`.
//
// The gate is only meaningful if it fails on a literal and reports the right line,
// so each case injects one and asserts on the outcome. The `clamp()` and token
// cases guard the opposite direction: legitimate uses must not be flagged.
//
// Run: node scripts/check-font-sizes.test.mjs

import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'

const CSS_PROBE = 'src/styles/__FontProbe.css'
const ASTRO_PROBE = 'src/components/__FontProbe.astro'

const cases = [
  {
    name: 'css: literal font-size is caught',
    file: CSS_PROBE,
    body: '.probe {\n  font-size: 0.72rem;\n}\n',
    expect: /__FontProbe\.css:2 font-size/,
  },
  {
    name: 'css: clamp() is allowed',
    file: CSS_PROBE,
    body: '.probe {\n  font-size: clamp(1rem, 2vw, 2rem);\n}\n',
    expect: null,
  },
  {
    name: 'css: token is allowed',
    file: CSS_PROBE,
    body: '.probe {\n  font-size: var(--text-base);\n}\n',
    expect: null,
  },
  {
    name: 'css: em is allowed (scale is rem-based)',
    file: CSS_PROBE,
    body: '.probe {\n  font-size: 1.2em;\n}\n',
    expect: null,
  },
  {
    name: 'astro: literal in <style> is caught at the right line',
    file: ASTRO_PROBE,
    body: '---\nconst a = 1\n---\n<div class="x">t</div>\n<style>\n  .x {\n    font-size: 0.72rem;\n  }\n</style>\n',
    expect: /__FontProbe\.astro:7 font-size/,
  },
  {
    name: 'astro: literal in font shorthand is caught',
    file: ASTRO_PROBE,
    body: '---\nconst a = 1\n---\n<div class="x">t</div>\n<style>\n  .x {\n    font: 600 0.9rem var(--font-mono);\n  }\n</style>\n',
    expect: /__FontProbe\.astro:7 font/,
  },
]

let failures = 0
for (const testCase of cases) {
  writeFileSync(testCase.file, testCase.body)
  const result = spawnSync(process.execPath, ['scripts/check-font-sizes.mjs'], { encoding: 'utf8' })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  const failed = result.status !== 0
  const ok = testCase.expect === null ? !failed : failed && testCase.expect.test(output)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`)
  if (!ok) {
    failures++
    console.log(
      `      status=${result.status} output=${output.split('\n').slice(0, 4).join(' | ')}`,
    )
  }
  rmSync(testCase.file, { force: true })
}

console.log(failures === 0 ? '\nALL FONT SIZE TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
