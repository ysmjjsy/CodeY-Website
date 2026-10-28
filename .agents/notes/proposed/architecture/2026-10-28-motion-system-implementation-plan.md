# Agent Note: Motion system implementation plan

Status: proposed

## Problem

The approved CodeY motion design system spans the desktop app and website, but the current desktop code already contains several motion owners, duration sets, task capsules, toast surfaces, and loop animations. A full migration needs an order that prevents duplicated state, preserves command semantics, and allows each phase to be tested and reverted independently.

## Proposal

Implement the motion system in phases: baseline inventory, Motion Foundation, shared primitives, page transitions, NoticeCenter, Task Island, feature and timeline migration, Website alignment, and final acceptance. Keep `motion/react` and Radix as the rendering primitives. Keep daemon snapshots, event projections, command payloads, permission semantics, recovery semantics, and SDK contracts unchanged.

Use `motion-foundation.tsx` and `global.css` as the shared desktop foundation. Add explicit ownership boundaries for `PageTransition`, `NoticeCenter`, `TaskIsland`, and motion primitives. Use a reversible provider or internal switch during the middle migration phases, and ship each phase as a separate commit.

## Alternatives considered

### Rewrite the desktop UI and runtime together

This would allow a clean end-to-end architecture and a single launch point. It expands a visual refactor into a daemon and protocol migration, increases regression surface, and makes a motion issue difficult to isolate or roll back.

### Replace Motion with a new animation library

A new renderer could provide different layout primitives. The existing app already has `motion/react`, presence helpers, tests, and Radix integration; changing libraries would combine a tooling migration with a design migration without improving the required state semantics.

### Migrate every call site in one large change

A single change may produce a consistent final result. It makes visual, accessibility, and task-state regressions hard to localize and prevents safe rollback of individual surfaces.

## Risks

- New and legacy variants can coexist during migration and produce double animations.
- Task Island may accidentally become a second owner of task or permission state.
- A motion-token check may require exemptions for legitimate loop or test values.
- Website and desktop can drift if their state names and Token semantics are not checked together.

## Acceptance criteria

- The implementation plan is published in Chinese and English and linked from the core-concepts sidebar.
- The plan names current desktop owners, migration phases, dependencies, tests, rollout, rollback, risks, and the boundary with daemon/runtime code.
- The plan requires focused desktop tests, Storybook or Playwright motion scenarios, reduced-motion coverage, and Website checks.
- The plan preserves existing task command, permission, recovery, event projection, and SDK semantics.
