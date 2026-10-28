# Agent Note: CodeY motion design system

Status: proposed

## Problem

CodeY's page transitions, notices, task states, loading indicators, and control feedback need one motion system. Existing prototypes use several independent durations and animation patterns, which makes the product state harder to read and makes cross-surface behavior inconsistent.

## Proposal

Adopt the motion system documented in `src/content/docs/docs/motion-system.md` and its English mirror. The system uses shared Motion Tokens, four motion layers, state-driven `data-state` rendering, and four shared animation responsibilities: `PageTransition`, `NoticeCenter`, `TaskIsland`, and motion primitives.

The design follows Apple-style motion principles: spatial continuity, local changes, immediate feedback, interruptible transitions, and restrained loops. The primary CodeY-specific container is Task Island, which carries running, streaming, permission, failed, and completed task states.

## Alternatives considered

### Keep component-local animation values

This requires less initial coordination and preserves existing CSS. It loses a shared rhythm, makes cross-surface tuning difficult, and allows equivalent states to move differently.

### Use one global duration and easing

This is easy to remember but cannot distinguish a button press from a page transition or a container morph. It makes short feedback feel slow or complex transitions feel abrupt.

### Use continuous ambient motion throughout the interface

Continuous motion can make the product feel active. It competes with task output, increases distraction, and makes reduced-motion support harder. Loops are therefore limited to states that are actively running or waiting.

## Risks

- A new shared token layer can leave old component values behind if migration is incomplete.
- Task Island requires an explicit UI state model; independently controlled loading, notice, and error flags can produce conflicting states.
- View Transitions and local component motion can overlap if page and component ownership are not kept separate.
- Reduced-motion behavior can become incomplete if each component implements its own exception.

## Acceptance criteria

- The Chinese and English motion-system documentation pages build and appear in the core-concepts sidebar.
- The documentation defines the shared Motion Tokens and four motion layers.
- Page transitions, notices, and Task Island have explicit timing, easing, state, and interruption rules.
- Loading, streaming, success, failure, list, theme, and reduced-motion behavior are specified.
- The implementation boundary is state-driven and names the shared components that own each animation responsibility.
- `pnpm check:astro`, `pnpm build:web`, and `pnpm check:agent-notes` pass.
