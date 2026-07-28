import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cargoManifest = resolve(projectRoot, 'Cargo.toml')
const astroCli = resolve(projectRoot, 'node_modules/astro/bin/astro.mjs')
const marketTargetDirectory = resolve(
  process.env.CODEY_MARKET_TARGET_DIR || resolve(projectRoot, '.codey-market/target'),
)
const target = process.argv[2] || 'all'

if (target !== 'all' && target !== 'market') {
  throw new Error('Usage: node scripts/build-site.mjs [market]')
}

if (target === 'all' && !existsSync(astroCli)) {
  throw new Error('Astro is not installed. Run pnpm install first.')
}

await run(
  'cargo',
  [
    'build',
    '--manifest-path',
    cargoManifest,
    '-p',
    'codey-market-server',
    '--release',
  ],
  {
    ...process.env,
    CARGO_TARGET_DIR: marketTargetDirectory,
  },
)
if (target === 'all') await run(process.execPath, [astroCli, 'build'])

function run(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${command} failed (${signal || code})`))
    })
  })
}
