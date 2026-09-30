/**
 * Mount/unmount contract — exercises `src/main.ts → SporaApp`.
 *
 * `main.ts` is the plugin bootstrap: it builds the Vue app, installs
 * Pinia + the local router, and exposes `mount()` / `unmount()` for
 * the host's `apps/registry.ts` to call. We test the contract
 * end-to-end against a fake DOM target — verifying:
 *
 *   1. `mount()` creates a Vue app and renders the plugin's CSS scope
 *      root into the target.
 *   2. The plugin's API bridge receives the host's typed REST client
 *      so descendants (`getApi()`) resolve at runtime, not just at
 *      compile time.
 *   3. `unmount()` is idempotent — calling it before mount, twice in a
 *      row, or after mount all leave the target in a clean state.
 *   4. `window.SporaAppCustomSkills` is installed (the IIFE lib wrapper
 *      also does this at build time; doing it again here makes the dev
 *      entry work standalone).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PluginHostContext } from '../src/shims'

function makeHostContext(): PluginHostContext {
    // `SkillsPage` runs on mount and calls `api.get('/principals/me')`,
    // `/custom-skills`, `/skills` and `/agents`. Return empty envelopes
    // for each so the fetches resolve instead of blowing up with
    // "Cannot read properties of undefined".
    const get = vi.fn().mockImplementation((path: string) => {
        if (path === '/principals/me') return Promise.resolve({ principals: [] })
        if (path === '/custom-skills') return Promise.resolve({ skills: [] })
        if (path === '/skills') return Promise.resolve({ skills: [] })
        if (path === '/agents') return Promise.resolve({ agents: [] })
        return Promise.resolve(undefined)
    })
    return {
        api: {
            get,
            post: vi.fn(),
            put: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
        },
        pinia: null,
        theme: 'light',
        route: null,
        router: null,
    }
}

function makeTarget(): HTMLElement {
    const target = document.createElement('div')
    target.id = 'app-mount-target'
    document.body.appendChild(target)
    return target
}

beforeEach(() => {
    document.body.innerHTML = ''
    // Reset module cache so each test re-evaluates `main.ts` and the
    // `window.SporaAppCustomSkills` assignment lands fresh.
    vi.resetModules()
    delete (window as unknown as { SporaAppCustomSkills?: unknown }).SporaAppCustomSkills
})

afterEach(() => {
    document.body.innerHTML = ''
    delete (window as unknown as { SporaAppCustomSkills?: unknown }).SporaAppCustomSkills
})

describe('SporaApp (main.ts mount contract)', () => {
    it('exposes mount + unmount via window.SporaAppCustomSkills', async () => {
        const main = await import('../src/main')
        expect(main.default).toBeDefined()
        expect(typeof main.default.mount).toBe('function')
        expect(typeof main.default.unmount).toBe('function')
        expect((window as unknown as { SporaAppCustomSkills: unknown }).SporaAppCustomSkills).toBe(main.default)
    })

    it('mount() renders the plugin CSS scope root into the target element', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        await main.default.mount(target, hostContext)
        await new Promise((r) => setTimeout(r, 0))
        // App.vue's `#spora-plugin-custom-skills` wrapper is the anchor
        // every Tailwind utility in the bundle is nested beneath. Losing
        // it unscopes the plugin CSS into the host.
        expect(target.querySelector('#spora-plugin-custom-skills')).not.toBeNull()
        expect(target.querySelector('main')).not.toBeNull()
    })

    it('mount() wires hostContext.api into the plugin-local api/client bridge', async () => {
        const main = await import('../src/main')
        const client = await import('../src/api/client')
        const target = makeTarget()
        const hostContext = makeHostContext()
        await main.default.mount(target, hostContext)
        // The bridge's `getApi()` must now resolve to the same instance
        // we passed in via `hostContext.api` (not throw "Plugin API
        // not initialized").
        expect(client.getApi()).toBe(hostContext.api)
    })

    it('mount() provides HOST_CONTEXT_KEY without emitting injection-not-found warnings', async () => {
        const warnings: string[] = []
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            warnings.push(args.map((a) => String(a)).join(' '))
        })

        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        await main.default.mount(target, hostContext)
        await new Promise((r) => setTimeout(r, 0))
        warnSpy.mockRestore()

        const injectionWarnings = warnings.filter((m) => /\[Vue warn\]: injection /.test(m))
        expect(injectionWarnings).toEqual([])
    })

    it('mount() installs a local router so the page can read the selected skill', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        await main.default.mount(target, makeHostContext())
        await new Promise((r) => setTimeout(r, 0))
        // `SkillsPage` calls `useRoute()` / `useRouter()` unconditionally;
        // an unbound router leaves the selected skill unaddressable and
        // emits an injection warning.
        expect(target.querySelector('[data-test="pane-mine"]')).not.toBeNull()
        expect(target.querySelector('[data-test="pane-preshipped"]')).not.toBeNull()
    })

    it('unmount() removes the mounted Vue app from the DOM', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        await main.default.mount(target, makeHostContext())
        await new Promise((r) => setTimeout(r, 0))
        expect(target.querySelector('main')).not.toBeNull()
        main.default.unmount(target)
        expect(target.querySelector('main')).toBeNull()
    })

    it('unmount() is a no-op when no app is mounted on the target', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        expect(() => main.default.unmount(target)).not.toThrow()
    })

    it('unmount() can be called repeatedly without error', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        await main.default.mount(target, makeHostContext())
        main.default.unmount(target)
        expect(() => main.default.unmount(target)).not.toThrow()
    })

    it('remounting the same target replaces the prior app', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        await main.default.mount(target, hostContext)
        await new Promise((r) => setTimeout(r, 0))
        const first = target.querySelector('main')
        expect(first).not.toBeNull()
        await main.default.mount(target, hostContext)
        await new Promise((r) => setTimeout(r, 0))
        const second = target.querySelector('main')
        expect(second).not.toBeNull()
        expect(second).not.toBe(first)
    })
})
