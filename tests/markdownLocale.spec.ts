/**
 * Every `md-editor-v3` component is rendered with an explicit English locale.
 *
 * The library's default locale table is `zh-CN`. A `<MdEditor>` or `<MdPreview>`
 * without `:language` therefore renders its chrome in Chinese — a fenced code
 * block's copy button reads `复制代码` inside an otherwise English panel, which is
 * exactly what shipped: the editor was localised and the two `<MdPreview>`
 * surfaces beside it were not.
 *
 * Neither component inherits `language` from a parent, so it has to be passed at
 * every call site. A behavioural test cannot catch a forgotten one — the
 * component mounts and behaves identically — so this reads the templates.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve(__dirname, '..')

function vueFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) return vueFiles(full)
        return full.endsWith('.vue') ? [full] : []
    })
}

/** Each opening tag of `component`, up to its closing `>`. */
function openingTags(source: string, component: string): string[] {
    const out: string[] = []
    const open = new RegExp(`<${component}\\b`, 'g')
    let match: RegExpExecArray | null
    while ((match = open.exec(source)) !== null) {
        const end = source.indexOf('>', match.index)
        if (end === -1) break
        out.push(source.slice(match.index, end + 1))
    }
    return out
}

describe('markdown chrome is localised', () => {
    const files = vueFiles(resolve(ROOT, 'src'))

    it('finds the components it is guarding, so the test cannot pass vacuously', () => {
        const tags = files.flatMap((f) => [
            ...openingTags(readFileSync(f, 'utf8'), 'MdEditor'),
            ...openingTags(readFileSync(f, 'utf8'), 'MdPreview'),
        ])
        // Two, and both still deliberate: `<MdEditor>` on the desk, which now owns
        // its own preview pane, and `<MdPreview>` in the viewer, which has no editor
        // to render one. The floor is the count that exists, so this cannot pass
        // vacuously if one of them goes away.
        expect(tags.length).toBeGreaterThanOrEqual(2)
    })

    it('passes :language at every MdEditor and MdPreview call site', () => {
        const unlocalised: string[] = []

        for (const file of files) {
            const source = readFileSync(file, 'utf8')
            for (const tag of [...openingTags(source, 'MdEditor'), ...openingTags(source, 'MdPreview')]) {
                if (!tag.includes(':language=')) {
                    const line = source.slice(0, source.indexOf(tag)).split('\n').length
                    unlocalised.push(`${file.replace(ROOT + '/', '')}:${line}`)
                }
            }
        }

        expect(
            unlocalised,
            'md-editor-v3 defaults to zh-CN, so a component without :language renders 复制代码',
        ).toEqual([])
    })

    it('keeps the locale in one place, so the surfaces cannot disagree', () => {
        const source = readFileSync(resolve(ROOT, 'src/lib/markdownLocale.ts'), 'utf8')
        expect(source).toMatch(/MARKDOWN_LOCALE\s*=\s*'en-US'/)
    })
})
