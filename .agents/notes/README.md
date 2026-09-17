# Agent Notes

This directory holds CodeY's decision records.

## History starts here

The repository does not carry retroactive decision history. Earlier documentation was removed because it had drifted from the code. Notes are recorded from this point forward.

That is a deliberate trade: no inherited records, but every record present is true. A note written today describes a decision that was actually made, with the reasoning that was actually used.

## Layout

Path is identity. A note's folder says where it stands; the filename says what it is about.

```
.agents/notes/
├── proposed/       designed, not yet built
├── implemented/    landed, and kept in sync with the code
├── rejected/       considered and declined, kept only to prevent a repeat
└── archived/       frozen; sealed by SHA-256, never edited
```

Each lifecycle contains the same six classes:

| Class | Use for |
|---|---|
| `feature` | New capability or user-visible behavior |
| `bug-fix` | A defect fix, or the gap a postmortem exposed |
| `simplification` | Removing code, behavior, or surface without adding any |
| `architecture` | Source layout, module boundaries, package dependencies |
| `process` | Tooling, checks, release and collaboration flow |
| `testing` | Test strategy and infrastructure |

Filenames are `yyyy-mm-dd-topic.md`, dated when the idea was first raised.

Moving a note between lifecycles is how its status changes. There is no status field to fall out of date.

## When to write one

Write a note when the change is non-trivial. By this repository's definition that means it touches **behavior, architecture, a cross-file contract, process or tooling, testing strategy, or an on-disk / wire / config format**. Also write one whenever a decision is the kind a future maintainer might reasonably revisit.

Skip purely mechanical edits: formatting, typo fixes, unambiguous renames, styling that changes no behavior, behavior-preserving dependency patches, and routine CRUD.

Over-recording and never recording are the same mistake pointing in opposite directions.

## What a note must contain

The first section is always `## Problem`, and it must stand on its own — delete the rest of the note and it should still describe a real problem.

Every note needs `## Alternatives considered`. For each option that lost, **state its strongest case first, then say why it lost.** A rejection that lists only an option's weaknesses is a strawman, and it is what causes a future session to confidently re-propose the same thing.

`## Consequences` states costs alongside benefits. A note that lists only upside has been edited to flatter its author.

## Keeping notes true

A note is a living statement about the current system, not a diary entry.

When the decision still holds and only facts moved — a path, a type name, a default — **edit the note in place**. Do not append a changelog and do not open a second note. A reader should always be able to open a note and see the present tense truth.

Only when the decision itself reverses do you write a new note, link the two, and let the old one go.

## Verification

```sh
pnpm check:agent-notes
```

Three checks run:

- `check-agent-note-tree.mjs` — lifecycle and class folders, filename shape, and relative links between notes.
- `check-agent-note-format.mjs` — header layout, lifecycle-specific sections, and a required `## Alternatives considered`. It also rejects proposal-era headings (`## Proposal`, `## Plan`, `## Acceptance criteria`) once a note is implemented.
- `check-archived-agent-notes.mjs` — archived notes must be byte-identical to their SHA-256 seal in `archived/manifest.json`, and seals are append-only against a git baseline.

All three are wired into CI, and into `pnpm check`.
