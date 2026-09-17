#!/usr/bin/env node

// Enforce Agent Note headers, lifecycle sections, and the mandatory
// `## Alternatives considered` section.
//
// Design notes:
//   - Headings are normalized before comparison. Upstream
//     czm15053/write-notes-like-deepseek compares raw strings for the banned
//     list, so `##  Proposal` (two spaces) or a tab slips past the gate. Here
//     every H2 is collapsed to a single-space canonical form first, so both the
//     required-section and banned-section checks see the same heading.
//   - Fenced code blocks and HTML comments are masked, so a `## Proposal` shown
//     inside a template example does not trip the gate.
//   - Present tense is a prose discipline, not a lexical scan: this script never
//     inspects body wording.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { notesRoot, walkAgentNoteTree } from './agent-note-tree.mjs'

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const STATUS = {
  proposed: /^Status: proposed$/,
  implemented: /^Status: implemented$/,
  rejected: /^Status: rejected — .+$/,
}

const REQUIRED = {
  proposed: [
    ['## Proposal', '## 提议', '## 方案', '## 提案'],
    ['## Acceptance criteria', '## 验收标准', '## 验收条件'],
    ['## Risks', '## 风险'],
  ],
  implemented: [
    ['## Decision', '## 决定', '## 决策'],
    ['## Consequences', '## 后果', '## 影响', '## 结果'],
  ],
  rejected: [['## Proposal', '## 提议', '## 方案', '## 提案']],
}

// Proposal-era headings are banned once a note is implemented.
const BANNED_IMPLEMENTED = new Set([
  '## proposal',
  '## plan',
  '## migration plan',
  '## acceptance criteria',
  '## 提议',
  '## 方案',
  '## 提案',
  '## 计划',
  '## 规划',
  '## 迁移计划',
  '## 验收标准',
  '## 验收条件',
])

const PROBLEM_HEADINGS = new Set(['## Problem', '## 问题'])

/** Collapse `##   Foo\t bar ` to `## Foo bar` so whitespace cannot evade a match. */
export function canonicalHeading(line) {
  const match = /^(#{1,6})\s+(.*?)\s*$/.exec(line)
  if (!match) return line.trimEnd()
  return `${match[1]} ${match[2].replace(/\s+/g, ' ')}`
}

/** Strip a trailing parenthetical: `## Decision（说明）` → `## Decision`. */
function headingBase(heading) {
  return heading.replace(/[（(].*$/, '').trimEnd()
}

function maskSource(raw) {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const fenced = new Array(lines.length).fill(false)
  const commented = new Array(lines.length).fill(false)
  let inFence = false
  let inComment = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    fenced[i] = inFence
    commented[i] = inComment
    if (!inComment && /^\s{0,3}```/.test(line)) {
      fenced[i] = true
      inFence = !inFence
    } else if (inFence) {
      fenced[i] = true
    }
    if (inFence) continue
    const openIdx = inComment ? -1 : line.indexOf('<!--')
    const closeIdx = line.indexOf('-->')
    if (inComment) {
      commented[i] = true
      if (closeIdx !== -1) inComment = false
    } else if (openIdx !== -1) {
      commented[i] = true
      if (closeIdx === -1 || closeIdx < openIdx) inComment = true
    }
  }
  return { lines, fenced, commented }
}

function isProse(source, index) {
  if (source.fenced[index] || source.commented[index]) return false
  return !/^\s*>/.test(source.lines[index])
}

export function checkAgentNoteFormat(root = defaultRoot) {
  const errors = []
  const { notes } = walkAgentNoteTree(root)
  const base = notesRoot(root)

  for (const note of notes) {
    const fail = (message) => errors.push(`format: ${note.rel} — ${message}`)
    const source = maskSource(readFileSync(join(base, note.rel), 'utf8'))
    const { lines } = source

    const proseIndexes = []
    for (let i = 0; i < lines.length; i++) if (isProse(source, i)) proseIndexes.push(i)
    const prose = proseIndexes.map((i) => lines[i])

    if (!/^# Agent Note[:：] ?\S/.test(lines[0] ?? ''))
      fail('line 1 must be `# Agent Note: <title>`')
    if (lines[1] !== '') fail('line 2 must be blank')
    const statusPattern = STATUS[note.lifecycle]
    if (statusPattern && !statusPattern.test(lines[2] ?? '')) {
      fail(`line 3 must match the ${note.lifecycle} status grammar (${String(statusPattern)})`)
    }
    if (lines[3] !== '') fail('line 4 must be blank')

    const looksLikeStatus = (line) => {
      const trimmed = line.trim()
      return (
        trimmed === 'Status: proposed' ||
        trimmed === 'Status: implemented' ||
        /^Status: rejected — .+$/.test(trimmed)
      )
    }
    if (prose.filter(looksLikeStatus).length !== 1) fail('Status: line must appear exactly once')

    // Match any whitespace run after ## — a tab or full-width space after the
    // hashes must not hide a heading from either the required or banned check.
    const headings = prose
      .filter((line) => /^##\s/.test(line))
      .map((line) => canonicalHeading(line))
    const bases = headings.map(headingBase)

    if (!PROBLEM_HEADINGS.has(headingBase(headings[0] ?? ''))) {
      fail(
        `first section must be ## Problem or ## 问题 (got ${JSON.stringify(headings[0] ?? '<none>')})`,
      )
    }

    for (const group of REQUIRED[note.lifecycle] ?? []) {
      if (!group.some((heading) => bases.includes(heading))) {
        fail(`missing one of ${JSON.stringify(group)}`)
      }
    }

    if (note.lifecycle === 'implemented') {
      for (const heading of bases.filter((h) => BANNED_IMPLEMENTED.has(h.toLowerCase()))) {
        fail(`banned in implemented: ${heading}`)
      }
    }

    if (
      !bases.some(
        (h) =>
          /^## Alternatives considered$/.test(h) || /^## .{0,8}?(?:替代方案|备选方案)$/.test(h),
      )
    ) {
      fail('missing ## Alternatives considered / ## 备选方案 (record what you rejected and why)')
    }
  }

  return errors
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = checkAgentNoteFormat()
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exit(1)
  }
  const { notes } = walkAgentNoteTree()
  console.log(`ok: ${notes.length} active note(s) verified`)
}
