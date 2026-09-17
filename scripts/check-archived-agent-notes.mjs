#!/usr/bin/env node

// Verify frozen archived Agent Notes.
//
// Archived notes are immutable evidence. Two independent mechanisms enforce it:
//   1. A SHA-256 seal per file, recorded in .agents/notes/archived/manifest.json.
//      Any edit to a sealed file is detected by re-hashing.
//   2. An append-only comparison of the manifest against a git baseline, so a
//      seal cannot be quietly removed to launder a modification.
//
// Usage:
//   node scripts/check-archived-agent-notes.mjs           # verify only
//   node scripts/check-archived-agent-notes.mjs --write   # seal unsealed files
//
// Env: AGENT_NOTE_ARCHIVE_BASE_REF (default HEAD) — git ref compared against for
// the append-only check. In CI this must be the pre-change commit, not HEAD.
// Without git the append-only check degrades gracefully.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARCHIVE, notesRoot } from './agent-note-tree.mjs'

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const isWrite = process.argv.includes('--write')

export function checkArchivedAgentNotes(root = defaultRoot) {
  const errors = []
  const warnings = []
  const base = notesRoot(root)
  const archivedDir = join(base, ARCHIVE)

  const files = []
  if (existsSync(archivedDir)) {
    const scan = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) scan(full)
        else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(relative(archivedDir, full).split('\\').join('/'))
        }
      }
    }
    scan(archivedDir)
  }

  // Head layout: L1 title / L2 blank / L3 Status / L4 Archived / L5 blank.
  const titlePattern = /^# Agent Note[:：] ?\S/
  const archivedPattern = /^Archived: \d{4}-\d{2}-\d{2}$/
  for (const rel of files) {
    const lines = readFileSync(join(archivedDir, rel), 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
    if (!titlePattern.test(lines[0] ?? ''))
      errors.push(`${rel} — line 1 must be \`# Agent Note: <title>\``)
    if (lines[1] !== '') errors.push(`${rel} — line 2 must be blank`)
    if (lines[2] !== 'Status: implemented')
      errors.push(`${rel} — line 3 must be \`Status: implemented\``)
    if (!archivedPattern.test(lines[3] ?? '')) {
      errors.push(`${rel} — line 4 must be \`Archived: YYYY-MM-DD\` immediately below Status`)
    }
    if (lines[4] !== '') errors.push(`${rel} — line 5 must be blank after Archived`)
  }

  const manifestPath = join(archivedDir, 'manifest.json')
  let manifest = { version: 1, files: {} }
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      errors.push('archived/manifest.json exists but is not valid JSON')
    }
  } else if (files.length > 0 && !isWrite) {
    errors.push('archived/manifest.json missing — run with --write to seal existing archived notes')
  }

  const sealOf = (relFromRoot) =>
    `sha256:${createHash('sha256')
      .update(readFileSync(join(base, relFromRoot)))
      .digest('hex')}`

  for (const rel of files) {
    const key = `${ARCHIVE}/${rel}`
    const entry = manifest.files[key]
    if (!entry) {
      if (isWrite) manifest.files[key] = sealOf(key)
      else errors.push(`${key} — missing seal in manifest.json (run with --write)`)
    } else if (entry !== sealOf(key)) {
      errors.push(
        `${key} — seal mismatch: archived note was modified after sealing (frozen notes must never change)`,
      )
    }
  }
  for (const key of Object.keys(manifest.files)) {
    if (!existsSync(join(base, key))) errors.push(`${key} — sealed entry has no file on disk`)
  }

  // Append-only check against a git baseline.
  let repoRoot = null
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: base,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    repoRoot = null
  }

  if (repoRoot) {
    const baseRef = process.env.AGENT_NOTE_ARCHIVE_BASE_REF || 'HEAD'
    const manifestRel = relative(repoRoot, manifestPath).split('\\').join('/')
    let baselineRaw = null
    try {
      baselineRaw = execFileSync('git', ['show', `${baseRef}:${manifestRel}`], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      // Manifest absent at the baseline — nothing to compare.
    }
    if (baselineRaw !== null) {
      try {
        const baseline = JSON.parse(baselineRaw)
        for (const [key, seal] of Object.entries(baseline.files ?? {})) {
          if (manifest.files[key] !== seal) {
            errors.push(
              `${key} — seal added/changed/removed relative to ${baseRef}; archived seals are append-only`,
            )
          }
        }
      } catch {
        errors.push(`archived/manifest.json at ${baseRef} was not valid JSON`)
      }
    }
  } else {
    warnings.push(
      'not a git repository — append-only check skipped (seal hashes still verified against disk)',
    )
  }

  return { errors, warnings, files, manifest, manifestPath, isWrite }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkArchivedAgentNotes()
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`archived: ${error}`)
    process.exit(1)
  }
  if (result.isWrite) {
    const sorted = Object.fromEntries(
      Object.entries(result.manifest.files).sort(([a], [b]) => a.localeCompare(b)),
    )
    writeFileSync(
      result.manifestPath,
      `${JSON.stringify({ version: 1, files: sorted }, null, 2)}\n`,
      'utf8',
    )
  }
  for (const warning of result.warnings) console.warn(`warning: ${warning}`)
  console.log(
    `ok: ${result.files.length} archived note(s) verified, ${Object.keys(result.manifest.files).length} seal(s) in manifest`,
  )
}
