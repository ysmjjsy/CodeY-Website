#!/usr/bin/env node

// Verify the note tree: lifecycle/class folders, filenames, and internal
// relative links between active notes.
//
// Run: node scripts/check-agent-note-tree.mjs

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateNoteLinks, walkAgentNoteTree } from './agent-note-tree.mjs'

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)))

export function checkAgentNoteTree(root = defaultRoot) {
  const { notes, errors } = walkAgentNoteTree(root)
  validateNoteLinks(root, notes, errors)
  return { notes, errors }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { notes, errors } = checkAgentNoteTree()
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exit(1)
  }
  console.log(`ok: ${notes.length} active note(s) tree and relative links verified`)
}
