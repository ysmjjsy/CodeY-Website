import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { checkAgentNoteFormat } from './check-agent-note-format.mjs'
import { checkAgentNoteTree } from './check-agent-note-tree.mjs'

const IMPLEMENTED = (body) => `# Agent Note: Example

Status: implemented

${body}
`

const GOOD_BODY = `## Problem

Something broke.

## Decision

We chose the thing.

## Alternatives considered

- **The other thing** — it was simpler; rejected because it breaks the boundary.

## Consequences

- Benefit: the boundary holds.
- Cost: an extra hop.
`

function fixture(root = mkdtempSync(join(tmpdir(), 'codey-notes-'))) {
  mkdirSync(join(root, '.agents', 'notes', 'implemented', 'architecture'), { recursive: true })
  mkdirSync(join(root, '.agents', 'notes', 'proposed', 'feature'), { recursive: true })
  return root
}

function write(root, lifecycle, cls, name, body) {
  const dir = join(root, '.agents', 'notes', lifecycle, cls)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), body)
}

test('accepts a well-formed note tree', () => {
  const root = fixture()
  write(root, 'implemented', 'architecture', '2026-09-17-example.md', IMPLEMENTED(GOOD_BODY))
  const { errors } = checkAgentNoteTree(root)
  assert.deepEqual(errors, [])
  assert.deepEqual(checkAgentNoteFormat(root), [])
})

test('rejects an unknown lifecycle folder', () => {
  const root = fixture()
  mkdirSync(join(root, '.agents', 'notes', 'invented'), { recursive: true })
  assert(checkAgentNoteTree(root).errors.some((e) => e.includes('unknown lifecycle folder')))
})

test('rejects an unknown class folder', () => {
  const root = fixture()
  mkdirSync(join(root, '.agents', 'notes', 'implemented', 'refactor'), { recursive: true })
  assert(checkAgentNoteTree(root).errors.some((e) => e.includes('unknown class folder')))
})

test('rejects a filename without a leading date', () => {
  const root = fixture()
  write(root, 'implemented', 'architecture', 'no-date.md', IMPLEMENTED(GOOD_BODY))
  assert(checkAgentNoteTree(root).errors.some((e) => e.includes('yyyy-mm-dd-topic.md')))
})

test('rejects a dangling relative link between notes', () => {
  const root = fixture()
  write(
    root,
    'implemented',
    'architecture',
    '2026-09-17-example.md',
    IMPLEMENTED(`${GOOD_BODY}\nSee [gone](../../implemented/architecture/2026-01-01-gone.md).\n`),
  )
  assert(checkAgentNoteTree(root).errors.some((e) => e.includes('target file does not exist')))
})

test('rejects a status that disagrees with the lifecycle folder', () => {
  const root = fixture()
  write(
    root,
    'implemented',
    'architecture',
    '2026-09-17-example.md',
    IMPLEMENTED(GOOD_BODY).replace('Status: implemented', 'Status: proposed'),
  )
  assert(
    checkAgentNoteFormat(root).some((e) => e.includes('must match the implemented status grammar')),
  )
})

test('rejects an implemented note that still carries proposal headings', () => {
  const root = fixture()
  write(
    root,
    'implemented',
    'architecture',
    '2026-09-17-example.md',
    IMPLEMENTED(`${GOOD_BODY}\n## Proposal\n\nplan text\n`),
  )
  assert(checkAgentNoteFormat(root).some((e) => e.includes('banned in implemented')))
})

// The upstream project compares raw heading strings, so extra whitespace slips
// a banned heading past its gate. These three cases lock the normalization in.
test('rejects banned headings that use extra spaces', () => {
  const root = fixture()
  write(
    root,
    'implemented',
    'architecture',
    '2026-09-17-example.md',
    IMPLEMENTED(`${GOOD_BODY}\n##  Proposal\n\nplan\n`),
  )
  assert(checkAgentNoteFormat(root).some((e) => e.includes('banned in implemented')))
})

test('rejects banned headings that use a full-width space', () => {
  const root = fixture()
  write(
    root,
    'implemented',
    'architecture',
    '2026-09-17-example.md',
    IMPLEMENTED(`${GOOD_BODY}\n##\u3000Proposal\n\nplan\n`),
  )
  assert(checkAgentNoteFormat(root).some((e) => e.includes('banned in implemented')))
})

test('rejects banned headings that use a tab', () => {
  const root = fixture()
  write(
    root,
    'implemented',
    'architecture',
    '2026-09-17-example.md',
    IMPLEMENTED(`${GOOD_BODY}\n##\tProposal\n\nplan\n`),
  )
  assert(checkAgentNoteFormat(root).some((e) => e.includes('banned in implemented')))
})

test('accepts required headings written with irregular whitespace', () => {
  const root = fixture()
  write(
    root,
    'implemented',
    'architecture',
    '2026-09-17-example.md',
    IMPLEMENTED(GOOD_BODY.replace('## Decision', '##  Decision')),
  )
  assert.deepEqual(
    checkAgentNoteFormat(root).filter((e) => e.includes('missing one of')),
    [],
  )
})

test('rejects a note with no Alternatives considered section', () => {
  const root = fixture()
  const stripped = GOOD_BODY.replace(/## Alternatives considered[\s\S]*?(?=## Consequences)/, '')
  write(root, 'implemented', 'architecture', '2026-09-17-example.md', IMPLEMENTED(stripped))
  assert(checkAgentNoteFormat(root).some((e) => e.includes('Alternatives considered')))
})

test('ignores headings inside fenced code blocks', () => {
  const root = fixture()
  write(
    root,
    'implemented',
    'architecture',
    '2026-09-17-example.md',
    IMPLEMENTED(`${GOOD_BODY}\n\`\`\`md\n## Proposal\n\`\`\`\n`),
  )
  assert.deepEqual(checkAgentNoteFormat(root), [])
})

test('ignores headings inside HTML comments', () => {
  const root = fixture()
  write(
    root,
    'implemented',
    'architecture',
    '2026-09-17-example.md',
    IMPLEMENTED(`${GOOD_BODY}\n<!--\n## Proposal\n-->\n`),
  )
  assert.deepEqual(checkAgentNoteFormat(root), [])
})

test('accepts a proposed note with the proposal skeleton', () => {
  const root = fixture()
  write(
    root,
    'proposed',
    'feature',
    '2026-09-17-example.md',
    `# Agent Note: Example

Status: proposed

## Problem

Something is missing.

## Proposal

Do the thing.

## Alternatives considered

- **Do nothing** — cheapest; rejected because the gap keeps biting.

## Acceptance criteria

- The thing works.

## Risks

- The thing might not work.
`,
  )
  assert.deepEqual(checkAgentNoteFormat(root), [])
})

test('rejects a rejected note without a reason on the status line', () => {
  const root = fixture()
  write(
    root,
    'rejected',
    'architecture',
    '2026-09-17-example.md',
    `# Agent Note: Example

Status: rejected

## Problem

Something.

## Proposal

The thing.

## Alternatives considered

- **The other** — rejected.
`,
  )
  assert(checkAgentNoteFormat(root).some((e) => e.includes('rejected status grammar')))
})
