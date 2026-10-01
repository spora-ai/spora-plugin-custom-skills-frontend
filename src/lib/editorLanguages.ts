/**
 * The language modes the source editor loads, and why this list and not the
 * catalogue.
 *
 * `@codemirror/language-data` carries all 143 modes and resolves them by file
 * extension — which is exactly the wrong shape here. It loads them with dynamic
 * `import()`, and `vite.config.ts` builds a single **IIFE** file, so there is no
 * code splitting to put them in: every dynamic import is inlined and the bundle
 * goes from 125 kB to 1 808 kB. Measured, not assumed.
 *
 * So the modes are static imports instead, and the set is chosen by what a skill
 * actually carries. The parser packages are small next to the catalogue:
 * json 1 kB, yaml 4 kB, python 13 kB, javascript 20 kB, css 15 kB, html 25 kB,
 * sql 52 kB — unminified, and the largest of them is the one most likely to be
 * wrong for a skill.
 *
 * A file with no mode here still gets the editor: line numbers, search, bracket
 * matching and undo do not depend on knowing the language.
 */
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { sql } from '@codemirror/lang-sql'
import type { LanguageSupport } from '@codemirror/language'

/** Extension (without the dot, lower case) to the support it configures. */
const BY_EXTENSION: Record<string, () => LanguageSupport> = {
    json: () => json(),
    yaml: () => yaml(),
    yml: () => yaml(),
    py: () => python(),
    js: () => javascript(),
    // One package covers all four: `typescript` is a flag on the JS parser, and
    // tsx/jsx are the same grammar with different wrapper tokens.
    jsx: () => javascript({ jsx: true }),
    ts: () => javascript({ typescript: true }),
    tsx: () => javascript({ typescript: true, jsx: true }),
    html: () => html(),
    htm: () => html(),
    css: () => css(),
    sql: () => sql(),
}

/** The mode for a path's extension, or null when the set has none for it. */
export function languageFor(path: string): LanguageSupport | null {
    const dot = path.lastIndexOf('.')
    if (dot === -1) return null
    const factory = BY_EXTENSION[path.slice(dot + 1).toLowerCase()]
    return factory === undefined ? null : factory()
}

/** The extensions this set covers, for the test that keeps the map honest. */
export const SUPPORTED_EXTENSIONS = Object.keys(BY_EXTENSION)
