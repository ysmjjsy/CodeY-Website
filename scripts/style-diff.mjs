// Compare two style snapshots produced by style-snapshot.mjs.
//
// Usage: node style-diff.mjs <before.json> <after.json>
//
// Reports every element whose computed style changed, grouped by property, and
// exits non-zero when there is any difference so it can gate a refactor.
import fs from 'node:fs'

const [beforePath, afterPath] = process.argv.slice(2)
const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'))
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'))

let totalDiffs = 0
const byProp = new Map()
const samples = []

for (const pageKey of Object.keys(before)) {
  const a = before[pageKey] || []
  const b = after[pageKey] || []
  if (a.length !== b.length) {
    console.log(`ELEMENT COUNT CHANGED on ${pageKey}: ${a.length} -> ${b.length}`)
    totalDiffs += Math.abs(a.length - b.length)
  }
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    for (const prop of Object.keys(a[i].style)) {
      const av = a[i].style[prop]
      const bv = b[i].style[prop]
      if (av !== bv) {
        totalDiffs++
        byProp.set(prop, (byProp.get(prop) || 0) + 1)
        if (samples.length < 25) {
          samples.push(
            `${pageKey} ${a[i].tag}.${String(a[i].cls).slice(0, 40)} ${prop}: ${av} -> ${bv}`,
          )
        }
      }
    }
  }
}

if (totalDiffs === 0) {
  console.log('IDENTICAL: no computed-style differences')
  process.exit(0)
}

console.log(`\n${totalDiffs} computed-style differences across ${byProp.size} properties\n`)
console.log('by property:')
for (const [p, c] of [...byProp.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${String(c).padStart(5)}  ${p}`)
}
console.log('\nsamples:')
for (const s of samples) console.log('  ' + s)
process.exit(1)
