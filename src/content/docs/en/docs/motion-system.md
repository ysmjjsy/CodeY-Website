---
title: Motion design system
description: Motion guidelines for CodeY page transitions, notifications, task states, control feedback, and state animations.
---

CodeY uses motion to explain state, provide feedback, and preserve spatial continuity. Motion is not decoration. Every page and component should reuse the motion tokens, state model, and implementation boundaries in this document.

This system follows Apple's public motion principles: motion should support status and feedback, remain interruptible, and preserve meaning when reduced motion is enabled. The values below are CodeY design baselines, not Apple's internal implementation constants.

## Motion principles

- **State first**: every animation corresponds to an understandable state change.
- **Spatial continuity**: an object returns to the place it came from; related pages preserve source and destination.
- **Local change**: animate only what actually changed.
- **Fast response**: provide feedback immediately after an interaction.
- **Interruptible**: dragging, back, and dismiss actions can change direction or cancel while moving.
- **Controlled loops**: looping motion means that a state is still active and stops as soon as the state ends.

## Motion tokens

Tokens live in `src/styles/tokens.css`. Pages and components must not create synonymous duration or easing values.

```css
:root {
  --motion-instant: 100ms;
  --motion-fast: 150ms;
  --motion-base: 220ms;
  --motion-page: 480ms;
  --motion-morph: 420ms;
  --motion-notice: 300ms;
  --motion-notice-exit: 200ms;
  --motion-reveal: 700ms;

  --motion-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --motion-ease-spring: cubic-bezier(0.32, 0.72, 0, 1);
  --motion-ease-linear: linear;
  --motion-ease-in-out: ease-in-out;

  --motion-loop-breathe: 1.6s;
  --motion-loop-spinner: 0.8s;
  --motion-loop-cursor: 1s;
}
```

| Token | Use |
| --- | --- |
| `100ms` | Pressed, color changes, icon states |
| `150ms` | Hover, focus, button feedback |
| `220ms` | Standard expand, fade, local replacement |
| `480ms` | Page transitions, task state changes |
| `420ms` | Sheets, Task Island, complex container morphs |

Loop periods are separate from interaction durations. Use them only for active, waiting, streaming, and cursor states.

## Motion layers

Every CodeY animation belongs to one of four layers.

| Layer | Purpose | Range |
| --- | --- | --- |
| Micro interaction | Buttons, tabs, hover, focus | `100–150ms` |
| Component state | Expand, loading, success, failure | `180–280ms` |
| Container transition | Pages, sheets, Task Island | `300–420ms` |
| Ambient state | Running, waiting, streaming | `0.8–1.6s` loop |

## Page transitions

### Standard pages

Use a same-surface crossfade: the old page fades out while the new page appears in the same content surface. Keep the page surface opaque so headings, buttons, and forms do not overlap during navigation.

```text
Enter: 480ms
Exit: 400ms
Page offset: 0
```

Astro routes use View Transitions. Page-level motion should only handle `opacity` and `transform`. Cards, headings, and buttons inside the page should not replay a full entrance animation.

### Cards to detail

Task cards, Market items, model cards, and file rows should use shared elements or FLIP to preserve object identity.

```text
Duration: 380–440ms
Starting scale: 0.96–0.98
Starting opacity: 0.85–1
```

The card radius may morph into the detail-page radius. The user should recognize which object became the detail page.

### Sheets and overlays

Sheets rise from the bottom while a scrim lowers the contrast of the content behind them.

```text
Enter: 420ms
Dismiss: 280–320ms
Scrim opacity: 0 → 0.18
```

Sheets support dragging. Complete dismissal after dragging beyond `35%` of the sheet height or releasing above `800px/s`; otherwise return to the original position.

## Notifications

Notifications have three categories with different motion: short result notices, persistent task states, and page-level status bars.

### Short result notices

Use for copy, save, delete, sign-in, and upload results.

```text
Enter: 300ms
Dwell: 3.5–5s
Exit: 200ms
Offset: 8px
Scale: 0.98 → 1
```

Deduplicate by event ID. Show one primary notice at a time. Success notices disappear quickly; error notices keep a resolving action visible.

### Persistent task states

Running, permission waiting, disconnected, failed, and recovery-required states stay attached to their task context. They do not disappear automatically. Update the task card or Task Island instead of repeatedly emitting toasts.

### Page-level status bars

Use a top status bar for global connection loss, updates, account state, and sign-in requirements.

```text
Enter: 280–320ms
Exit: 220ms
Height: 36–44px
```

## Task Island

Task Island is the CodeY container for a task's lifecycle. The current prototype's `.dock` should keep this responsibility.

Supported states:

```text
idle → running → streaming → completed
                    ↓
                permission
                    ↓
                 failed
```

| State | Height | Content |
| --- | ---: | --- |
| `idle` | `44–52px` | Input and send button |
| `running` | `48–56px` | Status dot, task name, elapsed time |
| `streaming` | `56–72px` | Output summary, stop button |
| `permission` | `96–132px` | Request, allow, deny |
| `failed` | `88–120px` | Cause, retry, details |
| `completed` | `52–64px` | Checkmark, result summary |

```text
Compact → expanded: 360–420ms
Expanded → compact: 300–360ms
Numeric update: 180–220ms
Completion check: 320–380ms
```

Preserve existing elements as the state changes. The task name, status dot, and timer do not re-enter; actions expand from the current container; completion shows the result before the container collapses.

```css
.task-island {
  overflow: clip;
  border-radius: var(--radius-xl);
  transition:
    height var(--motion-morph) var(--motion-ease-spring),
    border-radius var(--motion-morph) var(--motion-ease-spring);
}

.task-island__details {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--motion-morph) var(--motion-ease-spring),
    opacity var(--motion-base) var(--motion-ease-out);
}

.task-island[data-state="permission"] .task-island__details,
.task-island[data-state="failed"] .task-island__details {
  grid-template-rows: 1fr;
  opacity: 1;
}
```

## Control feedback

### Buttons

```css
.btn {
  transition:
    transform var(--motion-fast) var(--motion-ease-out),
    background-color var(--motion-base) var(--motion-ease-out),
    border-color var(--motion-base) var(--motion-ease-out),
    box-shadow var(--motion-base) var(--motion-ease-out);
}

.btn:active {
  transform: scale(0.98);
}
```

Use `150–220ms` for hover and focus color or border changes. Use `100–150ms` and `0.98` scale for press feedback. Controls should not use large scale changes or bouncing.

### Segmented controls and tabs

```text
Selection indicator: 280–320ms
Text color: 150ms
Tab content: 180–220ms
```

Move the selected background rather than jumping the button. Content changes use only a `4px` offset and an opacity transition.

### Disclosure panels

```text
Expand: 280–360ms
Chevron rotation: 220ms
Content opacity: 0 → 1
```

Rotate the chevron by `180°`. Do not scale the whole panel.

### Tooltips

```text
Show delay: 350–500ms
Enter: 150ms
Offset: 4px
```

Tooltips should not flicker while the pointer moves quickly across controls.

## Loading, streaming, and status dots

### Loading

```text
0–300ms: no indicator
300–1000ms: light skeleton or spinner
After 1s: status text
After 3s: progress, step, or elapsed time
```

The loading state should say what is happening, such as “Connecting to model”, “Reading files”, or “Waiting for permission”, instead of only showing a spinner.

### Streaming output

Update streaming content in chunks rather than character by character.

```text
Chunk size: 24–48 characters
Or update interval: 80–120ms
New content: 180–220ms
Offset: 4px → 0
```

Show the cursor only during streaming and focused input, with a `1s` period.

### Status dots

| State | Motion |
| --- | --- |
| idle | Still |
| running | `1.6s` expanding ring |
| waiting | `1.6s` breathing |
| failed | Still red |
| completed | One checkmark, then still |

Looping motion means that a state is still active. Stop it as soon as the state ends.

## Success, failure, and recovery

### Success

Draw the checkmark over `320–380ms`, then keep it still. Change the icon and status color; do not scale the entire card.

### Failure

Use one short feedback motion:

```text
Horizontal offset: 0 → 6px → -4px → 0
Duration: 180–220ms
```

Keep the state visible through an error border, icon, explanation, retry action, and details link. Do not use continuous shaking.

### Recovery

Keep recovery inside the original task container:

```text
Failed card → recovery actions → recovering → running in the original position
```

Do not create a new visual object for the same task.

## Lists and content changes

### Insert

```text
opacity: 0 → 1
translateY: 6px → 0
Duration: 220ms
```

Stagger at most three items, with `20–24ms` between them.

### Remove

```text
opacity: 1 → 0
height: current height → 0
Duration: 220–280ms
```

Use FLIP for the remaining items. Do not make each following row bounce.

### Sort and filter

Update only affected content. Remove old content quickly and introduce new content from its current position. Do not replay the entire page entrance.

## Theme changes and reduced motion

Theme changes animate color and shadow only:

```text
Background, border, text, shadow: 220–260ms
```

Do not rotate, scale, or reload the page.

With `prefers-reduced-motion: reduce`, disable page translation, rings, shimmer, spinners, and cursor blinking. Keep opacity and color changes so that state and meaning remain understandable.

## Implementation boundaries

Use the following structure:

```text
Business state
  ↓
UI state machine
  ↓
data-state / class
  ↓
CSS, View Transition, or local JS motion
```

Maintain four shared components:

- `PageTransition`: route and page hierarchy changes.
- `NoticeCenter`: short notices, page-level status bars, and deduplication.
- `TaskIsland`: running, streaming, permission, failure, and completion states.
- `Motion primitives`: `fade`, `slide`, `scale`, `morph`, `stagger`, and `presence`.

Business code changes state, for example `task.state = "permission"`; selectors and shared Motion Tokens drive the animation.

Prefer animating `transform`, `opacity`, and `clip-path`. Use `width`, `height`, `top`, `left`, `box-shadow`, and `filter: blur()` sparingly. Every state must work with mouse, keyboard, touch, and reduced-motion settings.

## Acceptance criteria

- Every animation explains a corresponding state change.
- Page transitions, notices, and Task Island use shared durations and easing.
- All looping animations stop when the task ends.
- State changes do not cause full-page reflow or replayed entrances.
- Back, dismiss, and drag interactions can be interrupted and cancelled.
- State and actions remain understandable with reduced motion enabled.
- Common interactions maintain stable frame rates without large areas of blur or continuously animated shadows.
