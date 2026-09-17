// Negative tests for `check-astro-styles.mjs`.
//
// The gate is only meaningful if it actually fails on a defect and reports the
// right line, so each case injects one and asserts on the outcome. A
// `:global(...)` case guards the opposite direction: the Astro-only syntax must
// not be reported as a false positive.
//
// Run: node scripts/check-astro-styles.test.mjs

import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

const file = 'src/components/__NegativeProbe.astro'
const cases = [
  { name: 'unknown property', css: '  .probe { colour: red; }', expect: 'noUnknownProperty' },
  {
    name: 'duplicate property',
    css: '  .probe { color: red; color: blue; }',
    expect: 'noDuplicateProperties',
  },
  { name: 'bad format', css: '  .probe{color:red}', expect: 'format' },
  {
    name: ':global() must not false-positive',
    css: '  .probe :global(pre) {\n    color: red;\n  }',
    expect: null,
  },
]
let failures = 0
for (const c of cases) {
  writeFileSync(
    file,
    `---\nconst a = 1\n---\n<div class="probe">x</div>\n<style>\n${c.css}\n</style>\n`,
  )
  const r = spawnSync(process.execPath, ['scripts/check-astro-styles.mjs'], { encoding: 'utf8' })
  const caught = (r.stderr || '').includes(c.expect ?? '')
  const exited = r.status !== 0
  const ok = c.expect === null ? !exited : exited && caught
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.name}` +
      (c.expect === null ? ' (should stay clean)' : ` -> ${c.expect}`),
  )
  if (!ok) {
    failures++
    console.log(
      '   stderr:',
      (r.stderr || '')
        .split('\n')
        .filter((l) => l.includes('NegativeProbe'))
        .slice(0, 3)
        .join(' | '),
    )
  }
}
rmSync(file, { force: true })
// line-number accuracy check
writeFileSync(
  file,
  `---\nconst a = 1\n---\n<div class="probe">x</div>\n<style>\n\n  .probe { colour: red; }\n</style>\n`,
)
const r = spawnSync(process.execPath, ['scripts/check-astro-styles.mjs'], { encoding: 'utf8' })
const m = /__NegativeProbe\.astro:(\d+)/.exec(r.stderr || '')
const line = m ? Number(m[1]) : 0
const okLine = line === 7
console.log(`${okLine ? 'PASS' : 'FAIL'}  line mapping (reported ${line}, expected 7)`)
if (!okLine) failures++
rmSync(file, { force: true })
console.log(
  failures === 0 ? '\nALL NEGATIVE TESTS PASSED' : `\n${failures} NEGATIVE TEST(S) FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
