/**
 * The plugin's Tailwind tokens must reference variables the HOST defines: the
 * bundle is mounted into the host document, so it inherits the host's `:root` and
 * `.dark` properties, and a missing `--x` produces a rule the browser silently
 * discards — the element renders unstyled with no error anywhere.
 *
 * Not hypothetical: `card: 'hsl(var(--card))'` shipped and the host has no
 * `--card`, so six `bg-card` surfaces were transparent.
 *
 * The host token list is vendored below because CI checks out only this repo. A
 * sibling checkout, when present, is cross-checked against it so the vendored
 * list cannot silently rot.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const PLUGIN_ROOT = resolve(__dirname, '..')

/**
 * Custom properties spora-frontend declares in `:root` and `.dark`
 * (spora-frontend/src/style.css, as of v0.29). Note what is NOT here: `--card`
 * and `--card-foreground` — the host's card IS its background.
 */
const HOST_TOKENS = [
    '--background', '--foreground', '--muted', '--muted-foreground',
    '--border', '--input', '--ring',
    '--primary', '--primary-foreground',
    '--secondary', '--secondary-foreground',
    '--destructive', '--destructive-foreground',
    '--accent', '--accent-foreground',
    '--radius',
]

const HOST_STYLE = resolve(PLUGIN_ROOT, '../spora-frontend/src/style.css')

function configSource(): string {
    return readFileSync(resolve(PLUGIN_ROOT, 'tailwind.config.ts'), 'utf8')
}

/**
 * Comments stripped, and necessarily so: the comment explaining the `--card` fix
 * quotes the broken value verbatim, and a text scan cannot tell prose from code.
 * Reading it as a live reference fails the test on the fix it documents.
 */
function configCode(): string {
    return configSource()
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * A Set of variables, not a token→variable Map: the config nests
 * `DEFAULT`/`foreground` under each colour family, so those keys repeat and a Map
 * silently collapses them.
 */
function pluginVariables(): Set<string> {
    const vars = new Set<string>()
    for (const m of configCode().matchAll(/hsl\(var\((--[a-z0-9-]+)\)\)/g)) {
        vars.add(m[1])
    }
    return vars
}

describe('tailwind tokens vs the host', () => {
    const vars = pluginVariables()

    it('finds the plugin’s colour variables', () => {
        // Guard the guard: an empty parse would pass everything below vacuously.
        expect(vars.size).toBeGreaterThan(10)
        expect(vars.has('--primary')).toBe(true)
        expect(vars.has('--destructive')).toBe(true)
    })

    it('only references CSS variables the host actually defines', () => {
        const dangling = [...vars].filter((v) => !HOST_TOKENS.includes(v))
        expect(dangling).toEqual([])
    })

    it('maps card onto the host’s background, not a non-existent --card', () => {
        // Pinned individually — the one that shipped broken, and the one a default
        // shadcn config copy would reintroduce.
        expect(HOST_TOKENS).not.toContain('--card')

        const config = configCode()
        expect(config).toContain("card: 'hsl(var(--background))'")
        expect(config).toContain("'card-foreground': 'hsl(var(--foreground))'")
        expect(config).not.toMatch(/var\(--card\)/)
    })

    it.skipIf(!existsSync(HOST_STYLE))('matches the vendored list against the real host stylesheet', () => {
        const css = readFileSync(HOST_STYLE, 'utf8')
        const actual = new Set<string>()
        for (const block of css.matchAll(/(?::root|\.dark)\s*\{([^}]*)\}/g)) {
            for (const decl of block[1].matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) {
                actual.add(decl[1])
            }
        }

        // Subset by design: only the tokens the plugin may reference.
        const stale = HOST_TOKENS.filter((t) => !actual.has(t))
        expect(stale, 'HOST_TOKENS lists a variable the host no longer defines').toEqual([])

        expect(actual.has('--background')).toBe(true)
        expect(actual.has('--card'), 'the host grew --card; the plugin should use it').toBe(false)
    })
})
