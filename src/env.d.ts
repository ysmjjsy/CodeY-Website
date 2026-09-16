/// <reference types="astro/client" />

// `@phosphor-icons/web` ships CSS-only subpath exports (e.g. `./regular`) and no
// type declarations, so TypeScript cannot resolve these side-effect imports.
declare module '@phosphor-icons/web/regular'
declare module '@phosphor-icons/web/thin'
declare module '@phosphor-icons/web/light'
declare module '@phosphor-icons/web/bold'
declare module '@phosphor-icons/web/fill'
declare module '@phosphor-icons/web/duotone'
