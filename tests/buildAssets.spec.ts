/**
 * The built assets, not the source.
 *
 * `scripts/smoke.js` is the release gate and covers the IIFE wrapper, the global
 * wiring and the preflight boundary. This spec covers the two things a source-level
 * test cannot see and a smoke regex would not catch:
 *
 * 1. **The scope of the hand-written CSS.** `tailwind.config.ts` sets
 *    `important: '#spora-plugin-custom-skills'`, which rewrites *generated
 *    utilities* only. A rule written by hand in `src/style.css` is emitted
 *    verbatim, so one unscoped selector would publish a class name into the host
 *    document. The rendered preview typography depends entirely on this.
 *    Third-party CSS is a separate matter: `md-editor-v3`'s stylesheet is
 *    unscoped by nature and the host already carries it from the memories panel.
 * 2. **The externals list.** The host publishes five globals; externalising an
 *    unpublished one produces a bundle that throws on import, so the panel becomes
 *    unreachable rather than degraded. The list is read from `vite.config.ts` so it
 *    cannot drift from what the build actually did.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const BUILT = existsSync(resolve(ROOT, 'frontend/style.css'))

/** Comments stripped: a rule quoted in a comment is not an emitted rule. */
function stripComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('hand-written CSS stays inside the plugin boundary', () => {
    it('scopes every rule it writes itself beneath the plugin root', () => {
        const source = stripComments(readFileSync(resolve(ROOT, 'src/style.css'), 'utf8'))
        // Split on `}` and keep the selector of each block; `@tailwind` at-rules
        // expand at build time and carry no selector of their own.
        const selectors = source
            .split('}')
            .map((block) => block.split('{')[0]?.trim() ?? '')
            .filter((selector) => selector !== '' && !selector.startsWith('@'))
            .map((selector) => selector.split(',').map((part) => part.trim()))

        expect(selectors.length).toBeGreaterThan(0)
        const unscoped = selectors.flat().filter((selector) => !selector.startsWith('#spora-plugin-custom-skills'))
        expect(unscoped, 'a hand-written selector would leak into the host document').toEqual([])
    })

    it.skipIf(!BUILT)('emits the scope prefix as a descendant selector, not as the scope element', () => {
        // `important: '#spora-plugin-custom-skills'` compiles to
        // `#spora-plugin-custom-skills .flex` — a *descendant* selector, which
        // cannot match the element carrying the id. So a utility class placed on
        // the panel root in App.vue is dead CSS that still looks correct in the
        // source, and the frame silently collapses to a content-sized block.
        // `App.vue` puts the frame on a child for this reason.
        //
        // This asserts the shape rather than the fix, so changing the prefix to
        // something that *does* match the scope element is allowed — it just has
        // to be a conscious change, and the root's classes become live again.
        const css = stripComments(readFileSync(resolve(ROOT, 'frontend/style.css'), 'utf8'))
        // Descendant form is `#id .util` (whitespace before the dot); a form that
        // also matches the scope element is `#id.util` (no whitespace).
        const matchesScopeElementItself = /#spora-plugin-custom-skills\./

        expect(
            matchesScopeElementItself.test(css),
            'the prefix now matches the scope element itself, so App.vue can put utilities on the root again',
        ).toBe(false)
    })

    it('the panel root carries no utility class, because none could reach it', () => {
        const source = readFileSync(resolve(ROOT, 'src/App.vue'), 'utf8')
        const rootTag = source.match(/<div id="spora-plugin-custom-skills"([^>]*)>/)
        expect(rootTag, 'the panel root should be findable by its scope id').not.toBeNull()

        const classes = (rootTag?.[1].match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
        expect(
            classes,
            'a class on the scope element cannot be styled by the prefixed bundle; put the frame on a child',
        ).toEqual([])
    })

    it.skipIf(!BUILT)("carries md-editor-v3's stylesheet, which is unscoped by nature", () => {
        // The desk writes in `<MdEditor>`, so `md-editor-v3/lib/style.css` ships with
        // it. That library's rules are not scoped to the plugin root and cannot be
        // made so without a build step that rewrites a third party's CSS: the built
        // sheet carries ~650 of them, 269 of them bare `div`. The host already
        // tolerates exactly this from the memories panel, which imports the same
        // stylesheet.
        //
        // So the guarantee is on the rules this plugin writes — the test above, on
        // `src/style.css` — plus proof that ours survived the library's CSS rather
        // than being overridden or dropped by it.
        const css = stripComments(readFileSync(resolve(ROOT, 'frontend/style.css'), 'utf8'))
        expect(css, 'the editor must be styled or the source pane is unstyled prose').toContain('.cm-editor')
        expect(css).toContain('#spora-plugin-custom-skills .md-preview')
        expect(css).toContain('#spora-plugin-custom-skills .scroll-quiet')
    })

    it('disables the `container` core plugin, which escapes `important` scoping', () => {
        // Emitted unscoped, `width: 100%` from this bundle would apply to every
        // `.container` in the host SPA. The plugin centres its pages with `max-w-*`
        // and never uses the class.
        const config = readFileSync(resolve(ROOT, 'tailwind.config.ts'), 'utf8')
            .replace(/(^|[^:])\/\/.*$/gm, '$1')
            .replace(/\/\*[\s\S]*?\*\//g, '')
        expect(config).toMatch(/corePlugins:\s*\{[^}]*container:\s*false/)
    })

    it.skipIf(!BUILT)('carries the preview typography, which the desk and viewer both rely on', () => {
        const css = stripComments(readFileSync(resolve(ROOT, 'frontend/style.css'), 'utf8'))
        expect(css).toContain('#spora-plugin-custom-skills .md-preview')
        expect(css).toContain('#spora-plugin-custom-skills .scroll-quiet')
    })

    it.skipIf(!BUILT)('ships CodeMirror’s stylesheet, because the desk mounts the editor', () => {
        // `md-editor-v3/lib/style.css` is ~64 kB of editor styling. The desk writes
        // in `<MdEditor>` — a skill body needs the markdown toolbar — so the
        // stylesheet is what makes the source pane legible rather than unstyled.
        const css = stripComments(readFileSync(resolve(ROOT, 'frontend/style.css'), 'utf8'))
        expect(css).toContain('.cm-editor')
    })
})

describe('the externals list is exactly what the host publishes', () => {
    /**
     * `spora-frontend/src/utils/publishPluginGlobals.ts` publishes exactly these
     * five. Four are consumed here; `VueDraggablePlus` is published for other
     * plugins.
     */
    const HOST_GLOBALS = ['Vue', 'Pinia', 'VueRouter', 'VueDraggablePlus', 'MdEditorV3']

    /**
     * Comments stripped, and necessarily: the config's own docblock quotes
     * `extend: true` and `this.<name> =` to explain why neither is there, and a
     * text scan cannot tell that prose from configuration.
     *
     * Line comments first, then block: a line comment in this file contains an
     * opening block-comment delimiter (the dev proxy glob), so stripping blocks
     * first would swallow everything from there to the next close — the whole
     * `external` list with it.
     */
    function viteConfig(): string {
        return readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8')
            .replace(/(^|[^:])\/\/.*$/gm, '$1')
            .replace(/\/\*[\s\S]*?\*\//g, '')
    }

    function externalBlock(): string {
        const source = viteConfig()
        const start = source.indexOf('external: [')
        expect(start, 'vite.config.ts no longer declares an `external` list').toBeGreaterThan(-1)
        return source.slice(start, source.indexOf(']', start))
    }

    function externals(): string[] {
        return [...externalBlock().matchAll(/'([^']+)'/g)].map((m) => m[1] as string)
    }

    it('externalises only published globals', () => {
        const source = viteConfig()
        const list = externals()
        expect(list.length).toBeGreaterThan(0)
        for (const module of list) {
            // The `globals` map keys on the module specifier, quoted or bare.
            const mapping = new RegExp(`['"]?${module}['"]?\\s*:\\s*['"]window\\.\\w+['"]`)
            expect(mapping.test(source), `${module} is externalised but mapped to no window global`).toBe(true)
            const global = /['"]window\.(\w+)['"]/.exec(mapping.exec(source)![0])?.[1] ?? ''
            expect(
                HOST_GLOBALS.includes(global),
                `window.${global} is not one the host publishes`,
            ).toBe(true)
        }
    })

    it('bundles lucide-vue-next and dompurify, which the host does not publish', () => {
        // The mistake that shipped once: a bundle externalising an unpublished global
        // throws while the IIFE argument list resolves, so `window.SporaAppCustomSkills`
        // is never assigned and the panel is unreachable.
        const list = externals()
        expect(list).not.toContain('lucide-vue-next')
        expect(list).not.toContain('dompurify')
    })

    it('leaves `output.extend` off — the host imports this bundle in module scope', () => {
        // The brief for this work says `output.extend: true` is required; the config
        // and `scripts/smoke.js` both say the opposite, and the smoke gate is
        // authoritative. `extend: true` emits `this.SporaAppCustomSkills = …`, and
        // module scope is `undefined` under the host's dynamic `import()`, so the
        // assignment throws before the real global is ever assigned.
        expect(viteConfig()).not.toContain('extend: true')
        expect(readFileSync(resolve(ROOT, 'scripts/smoke.js'), 'utf8')).toContain('badWrapper')
    })
})
