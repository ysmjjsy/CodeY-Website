#!/usr/bin/env node

// Shared structural source of truth for the Agent Note tree.
//
// The note tree lives at .agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md.
// Lifecycle and class are closed sets: an unknown folder is a violation, not a
// new category. Path is identity — moving a note between lifecycles is the only
// supported way to change its status.
//
// Ported from czm15053/write-notes-like-deepseek, adapted to this repository's
// zero-dependency `node --test` + scripts/*.mjs house style (the upstream
// version requires `npx tsx`).

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)))

export const LIFECYCLES = ['proposed', 'implemented', 'rejected']
export const CLASSES = [
  'feature',
  'bug-fix',
  'simplification',
  'architecture',
  'process',
  'testing',
]
export const ARCHIVE = 'archived'

export function notesRoot(root = defaultRoot) {
  return join(root, '.agents', 'notes')
}

/** Recurse `dir`, returning posix-relative `.md` paths prefixed with `prefix`. */
function listMarkdown(dir, prefix) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listMarkdown(join(dir, entry.name), rel))
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(rel)
  }
  return out
}

/**
 * Walk the active note tree (proposed/implemented/rejected).
 *
 * Archived notes are intentionally excluded: they are frozen evidence, checked
 * by verify-archived-agent-notes.mjs instead.
 */
export function walkAgentNoteTree(root = defaultRoot) {
  const base = notesRoot(root)
  const notes = []
  const errors = []

  if (!existsSync(base)) return { notes, errors }

  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === ARCHIVE) continue
    if (!LIFECYCLES.includes(entry.name)) {
      errors.push(
        `structure: ${entry.name}/ — unknown lifecycle folder (allowed: ${LIFECYCLES.join(', ')}, plus ${ARCHIVE}/)`,
      )
    }
  }

  for (const lifecycle of LIFECYCLES) {
    // Validate class folders even when empty, so a wrongly-named folder is
    // caught before the first note lands in it.
    const lifecycleDir = join(base, lifecycle)
    if (existsSync(lifecycleDir)) {
      for (const entry of readdirSync(lifecycleDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (!CLASSES.includes(entry.name)) {
          errors.push(
            `structure: ${lifecycle}/${entry.name}/ — unknown class folder "${entry.name}" (allowed: ${CLASSES.join(', ')})`,
          )
        }
      }
    }

    for (const rel of listMarkdown(lifecycleDir, lifecycle).sort()) {
      const segments = rel.split('/')
      const cls = segments[1]
      const baseName = segments[2]
      if (segments.length !== 3 || cls === undefined || baseName === undefined) {
        errors.push(
          `structure: ${rel} — expected {lifecycle}/{class}/file.md (got depth ${segments.length})`,
        )
        continue
      }
      if (!CLASSES.includes(cls)) {
        errors.push(
          `structure: ${rel} — unknown class folder "${cls}" (allowed: ${CLASSES.join(', ')})`,
        )
        continue
      }
      if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(baseName)) {
        errors.push(`structure: ${rel} — filename must be yyyy-mm-dd-topic.md`)
        continue
      }
      notes.push({ lifecycle, rel, date: baseName.slice(0, 10) })
    }
  }

  return { notes, errors }
}

/** Relative markdown links inside active notes must resolve to real files. */
export function validateNoteLinks(root, notes, errors) {
  const base = notesRoot(root)
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g

  for (const note of notes) {
    const full = join(base, note.rel)
    if (!existsSync(full)) continue
    const source = readFileSync(full, 'utf8')
    for (const match of source.matchAll(linkPattern)) {
      const raw = (match[2] ?? '').trim()
      if (!raw) continue
      if (/^(?:https?:|mailto:|#)/.test(raw)) continue
      const fileTarget = raw.split('#')[0]
      if (!fileTarget) continue
      const resolved = resolve(dirname(full), fileTarget)
      // Only verify targets inside the note tree; a link out to source code is
      // validated by construction, not by this check.
      if (!resolved.startsWith(base)) continue
      if (!existsSync(resolved)) {
        errors.push(`link: ${note.rel} -> "${raw}" target file does not exist`)
      }
    }
  }
}
