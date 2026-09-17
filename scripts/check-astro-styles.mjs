// Policy gate for the CSS inside `.astro` `<style>` blocks.
//
// Biome does not parse `<style>` blocks in `.astro` files: with `src/**/*.astro`
// in `files.includes`, it checks the frontmatter and the template expressions but
// silently ignores the CSS between `<style>` and `</style>`. On this site that is
// 24 blocks and roughly 3200 lines — the majority of the component styling — so
// `pnpm lint` alone leaves it unguarded.
//
// This script closes that gap without adding a dependency: it extracts every
// `<style>` block to a temporary directory, translates the Astro-specific
// `:global(...)` wrapper into plain CSS so Biome can parse it, runs the project's
// own Biome binary over the result, and maps each diagnostic back to the original
// `.astro` file and line.
//
// Usage: node scripts/check-astro-styles.mjs
// Exits non-zero when Biome reports an error or warning in an extracted block.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = resolve(projectRoot, 'src')
const biomeBinary = resolve(projectRoot, 'node_modules/.bin/biome')

if (!existsSync(biomeBinary)) {
  console.error('Biome is not installed. Run pnpm install first.')
  process.exit(1)
}

/** Every `.astro` file under `src/`, recursively. */
function collectAstroFiles(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...collectAstroFiles(full))
    else if (entry.name.endsWith('.astro')) found.push(full)
  }
  return found.sort()
}

/**
 * Rewrite Astro-only syntax into CSS Biome can parse.
 *
 * `:global(.foo)` means "do not scope this selector". Biome does not know the
 * pseudo-class and reports `noUnknownPseudoClass` on every use, which would bury
 * the real diagnostics. Replacing it with its argument preserves the selector's
 * meaning for lint purposes.
 *
 * Handles one level of nesting, which is what this codebase uses
 * (`:global(pre)`, `:not(:where(pre code))` appears outside `:global`).
 */
function normalizeAstroCss(css) {
  return css.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
}

/**
 * Remove the single level of indentation a `<style>` block inherits from being
 * nested inside an `.astro` file.
 *
 * Without this every block reports a spurious `format` diagnostic, because the
 * formatter wants to de-indent CSS that is only indented to sit inside the tag.
 * The dedent uses the smallest indent of any non-blank line, so a block that is
 * deliberately unindented is left alone.
 */
function dedent(css) {
  const lines = css.split('\n')
  let smallest = Infinity
  for (const line of lines) {
    if (line.trim() === '') continue
    const indent = line.length - line.replace(/^[ \t]+/, '').length
    if (indent < smallest) smallest = indent
  }
  if (smallest === Infinity || smallest === 0) return css
  const padding = ' '.repeat(smallest)
  return lines.map((line) => (line.startsWith(padding) ? line.slice(smallest) : line)).join('\n')
}

/**
 * Extract `<style>` block contents with the line number each block's CSS starts
 * on, so diagnostics can be reported against the `.astro` source.
 */
function extractStyleBlocks(source) {
  const blocks = []
  const pattern = /<style([^>]*)>([\s\S]*?)<\/style>/g
  for (;;) {
    const match = pattern.exec(source)
    if (match === null) break
    const before = source.slice(0, match.index)
    // `before` ends immediately before `<style`, so its line count is the 1-based
    // line the tag starts on. The CSS body begins on the tag's *last* line (right
    // after `>`), hence `openTagLines - 1`, then advances by the newlines that
    // separate the tag from the first declaration.
    const openTagLines = match[0].slice(0, match[0].indexOf('>') + 1).split('\n').length
    const tagStartLine = before.split('\n').length
    const rawCss = match[2]
    // The formatter requires the file to begin at the first declaration rather than
    // at a blank line, so drop the newline after `<style>` and count it as an
    // offset to keep reported line numbers aligned with the `.astro` source.
    const leadingNewlines = rawCss.length - rawCss.replace(/^\n+/, '').length
    const css = dedent(rawCss.slice(leadingNewlines)).replace(/\s+$/, '\n')
    blocks.push({
      attributes: match[1].trim(),
      css,
      cssStartLine: tagStartLine + (openTagLines - 1) + leadingNewlines,
    })
  }
  return blocks
}

const workDirectory = mkdtempSync(join(tmpdir(), 'codey-astro-styles-'))
const manifest = []

try {
  for (const file of collectAstroFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8')
    for (const block of extractStyleBlocks(source)) {
      if (block.css.trim() === '') continue
      const temp = join(workDirectory, `${manifest.length}.css`)
      writeFileSync(temp, normalizeAstroCss(block.css))
      manifest.push({
        tempFile: relative(workDirectory, temp),
        sourceFile: relative(projectRoot, file),
        cssStartLine: block.cssStartLine,
        scoped: !/\bis:global\b/.test(block.attributes),
      })
    }
  }

  // Biome needs a config in the working directory. Inherit the project's
  // formatter and linter settings so the same policy applies inside `<style>`
  // blocks as to standalone stylesheets — otherwise this gate would enforce a
  // different rule set from `pnpm lint` and drift apart over time. Only
  // `files.includes` is overridden, to point at the extracted CSS.
  const projectConfigPath = resolve(projectRoot, 'biome.json')
  const projectConfig = JSON.parse(
    // biome.json is JSONC; strip line comments and trailing commas before parsing.
    readFileSync(projectConfigPath, 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1'),
  )
  writeFileSync(
    join(workDirectory, 'biome.json'),
    `${JSON.stringify(
      {
        $schema: projectConfig.$schema,
        files: { includes: ['**/*.css'] },
        formatter: projectConfig.formatter,
        javascript: projectConfig.javascript,
        linter: projectConfig.linter,
      },
      null,
      2,
    )}\n`,
  )

  const result = spawnSync(
    biomeBinary,
    ['check', '--reporter=json', '--max-diagnostics=1000', '--config-path=.', '.'],
    { cwd: workDirectory, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )

  const byTempFile = new Map(manifest.map((entry) => [entry.tempFile, entry]))
  const diagnostics = []

  const stdout = (result.stdout || '').trim()
  if (stdout) {
    let parsed
    try {
      parsed = JSON.parse(stdout)
    } catch {
      console.error('Could not parse Biome JSON output.')
      console.error(stdout.slice(0, 2000))
      process.exit(1)
    }
    for (const diag of parsed.diagnostics ?? []) {
      const location = diag.location ?? {}
      // Biome reports `location.path` as a string relative to its cwd.
      const rawPath = typeof location.path === 'string' ? location.path : ''
      const entry =
        byTempFile.get(rawPath) ??
        byTempFile.get(rawPath.replace(/^\.\//, '')) ??
        manifest.find((candidate) => rawPath.endsWith(candidate.tempFile))
      if (!entry) continue
      // Ignore the `deserialize` notice about Biome's own config file, and any
      // diagnostic whose location is not one of our extracted stylesheets.
      if (location.path === 'biome.json') continue
      // Biome line numbers are 1-based within the extracted file; a `format`
      // diagnostic reports line 0 because it covers the whole file.
      const line =
        location.start && location.start.line > 0
          ? entry.cssStartLine + location.start.line - 1
          : entry.cssStartLine
      diagnostics.push({
        file: entry.sourceFile,
        line,
        severity: diag.severity ?? 'error',
        category: diag.category ?? '',
        message: (diag.description ?? diag.message ?? '').replace(/\s+/g, ' ').trim(),
      })
    }
  }

  if (diagnostics.length === 0) {
    console.log(`Astro style check passed (${manifest.length} <style> blocks).`)
    process.exit(0)
  }

  diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  console.error('Astro style check failed.\n')
  for (const diagnostic of diagnostics) {
    console.error(
      `- ${diagnostic.file}:${diagnostic.line} [${diagnostic.category}] ${diagnostic.message}`,
    )
  }
  console.error(`\n${diagnostics.length} problem(s) in <style> blocks.`)
  process.exit(1)
} finally {
  rmSync(workDirectory, { recursive: true, force: true })
}
