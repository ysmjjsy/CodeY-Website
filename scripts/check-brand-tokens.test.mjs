// Negative tests for `check-brand-tokens.mjs`.
//
// A contract check that cannot fail is not a contract check. Each case mutates a
// copy of the real token file to introduce one specific drift, then asserts the
// gate reports it. The unmodified case asserts it stays quiet.
//
// Run: node scripts/check-brand-tokens.test.mjs

import { spawnSync } from 'node:child_process'
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const TOKENS = 'src/styles/tokens.css'
const BACKUP = `${TOKENS}.contract-test-backup`

const original = readFileSync(TOKENS, 'utf8')
copyFileSync(TOKENS, BACKUP)

const cases = [
  {
    name: 'clean tree passes',
    mutate: (css) => css,
    expect: null,
  },
  {
    name: 'website brand colour drifts from desktop',
    mutate: (css) => css.replace('--accent: #4f46e5;', '--accent: #4f46e6;'),
    expect: /brand primary mismatch \(light\)/,
  },
  {
    name: 'contract alias missing',
    mutate: (css) => css.replace('  --primary: var(--accent);\n', ''),
    expect: /--primary is missing/,
  },
  {
    name: 'contract alias points elsewhere',
    mutate: (css) => css.replace('  --ring: var(--accent);', '  --ring: var(--accent-ring);'),
    expect: /--ring is "var\(--accent-ring\)", expected "var\(--accent\)"/,
  },
  {
    name: 'cyan used as a brand colour',
    mutate: (css) => css.replace('--accent: #4f46e5;', '--accent: #06b6d4;'),
    expect: /uses cyan/,
  },
]

let failures = 0
try {
  for (const testCase of cases) {
    writeFileSync(TOKENS, testCase.mutate(original))
    const result = spawnSync(process.execPath, ['scripts/check-brand-tokens.mjs'], {
      encoding: 'utf8',
    })
    const output = `${result.stdout || ''}${result.stderr || ''}`
    const failed = result.status !== 0
    const ok = testCase.expect === null ? !failed : failed && testCase.expect.test(output)
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`)
    if (!ok) {
      failures++
      console.log(`      status=${result.status}`)
      console.log(`      output=${output.split('\n').filter(Boolean).slice(0, 3).join(' | ')}`)
    }
  }
} finally {
  // Always restore, even if a case throws.
  writeFileSync(TOKENS, original)
  rmSync(BACKUP, { force: true })
}

console.log(failures === 0 ? '\nALL BRAND CONTRACT TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
