/**
 * The language set, and the reason it is a set rather than the catalogue.
 *
 * `@codemirror/language-data` resolves modes by extension and loads them with
 * dynamic `import()`. `vite.config.ts` builds a single **IIFE** file, so there is
 * no code splitting to put a dynamic import in: every one of its 136 becomes part
 * of the bundle. Measured — `main.js` went 125 kB → 1 808 kB.
 *
 * So the modes are static imports, and this test is what keeps the cost honest: a
 * new entry has to be a deliberate choice, and the map must not quietly grow back
 * toward the catalogue.
 */
import { describe, it, expect } from 'vitest'
import { languageFor, SUPPORTED_EXTENSIONS } from '../../src/lib/editorLanguages'

describe('the editor language set', () => {
    it('resolves a mode for the formats a skill plausibly carries', () => {
        const expected: Record<string, string> = {
            'data.json': 'json',
            'config.yaml': 'yaml',
            'config.yml': 'yaml',
            'scripts/run.py': 'python',
            'src/app.js': 'javascript',
            // A `.ts` file parsed as plain JavaScript is a quiet failure: the
            // grammar accepts it and the highlighting is simply wrong.
            'src/app.ts': 'typescript',
            'src/app.tsx': 'typescript',
            'page.html': 'html',
            'style.css': 'css',
            'schema.sql': 'sql',
        }

        for (const [path, name] of Object.entries(expected)) {
            expect(languageFor(path)?.language.name, path).toBe(name)
        }
    })

    it('leaves markdown to md-editor-v3, so it is deliberately absent here', () => {
        // The desk routes `.md` to `<MdEditor>` and never mounts this component
        // for it, so a markdown mode here would be dead weight in the bundle.
        expect(languageFor('notes.md')).toBeNull()
    })

    it('is case-insensitive, because a path is not required to be lowercase', () => {
        expect(languageFor('DATA.JSON')?.language.name).toBe('json')
        expect(languageFor('Report.PY')?.language.name).toBe('python')
    })

    it('returns null rather than guessing, so a mode is never wrong by accident', () => {
        for (const path of ['Makefile', 'README', 'archive.tar.gz', 'notes.md.txt', '']) {
            expect(languageFor(path), path).toBeNull()
        }
    })

    it('stays a deliberate, small set — this is the bundle-size guard', () => {
        // Every entry is a static import of a parser. The whole point of not
        // using `@codemirror/language-data` is that this number is small and
        // chosen; a test is the only thing that keeps it that way.
        expect(SUPPORTED_EXTENSIONS.length).toBeLessThanOrEqual(16)
    })

    it('has no extension in the set that nothing can resolve, or vice versa', () => {
        for (const extension of SUPPORTED_EXTENSIONS) {
            expect(languageFor(`file.${extension}`), extension).not.toBeNull()
        }
    })
})
