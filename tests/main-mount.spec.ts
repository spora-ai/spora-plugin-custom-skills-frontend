/**
 * Mount/unmount contract for `src/main.ts → SporaApp`, end-to-end against a fake
 * DOM target. `main.ts` builds the Vue app, installs Pinia + the local router, and
 * exposes `mount()` / `unmount()` for the host's `apps/registry.ts`.
 *
 * The two load-bearing cases: the plugin's API bridge must receive the host's
 * client so descendants' `getApi()` resolves at runtime, not just at compile time;
 * and `unmount()` must be idempotent before, after and twice over a mount.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PluginHostContext } from '../src/shims'

function makeHostContext(): PluginHostContext {
    // `SkillsPage` fetches these four envelopes on mount; empty ones resolve
    // instead of blowing up with "Cannot read properties of undefined".
    const get = vi.fn().mockImplementation((path: string) => {
        // A principal, so the scope bar and the home heading have something to name.
        if (path === '/principals/me') {
            return Promise.resolve({ principals: [{ id: 7, type: 'user', name: 'Maya Fischer', user_id: 3, group_id: null }] })
        }
        if (path === '/custom-skills' || path.startsWith('/custom-skills?')) return Promise.resolve({ skills: [] })
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
    // Reset the module cache so the `window.SporaAppCustomSkills` assignment
    // lands fresh in each test.
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
        // `#spora-plugin-custom-skills` is the anchor every Tailwind utility nests
        // beneath; losing it unscopes the plugin CSS into the host.
        expect(target.querySelector('#spora-plugin-custom-skills')).not.toBeNull()
        expect(target.querySelector('[data-test="home-page"]')).not.toBeNull()
    })

    it('mount() wires hostContext.api into the plugin-local api/client bridge', async () => {
        const main = await import('../src/main')
        const client = await import('../src/api/client')
        const target = makeTarget()
        const hostContext = makeHostContext()
        await main.default.mount(target, hostContext)
        // Must resolve to the instance passed via `hostContext.api`, not throw
        // "Plugin API not initialized".
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

    it('mount() installs a local router so the scope bar can read the current route', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        await main.default.mount(target, makeHostContext())
        await new Promise((r) => setTimeout(r, 0))
        // The scope bar calls `useRoute()` / `useRouter()` unconditionally; an
        // unbound router leaves it on `START_LOCATION` and warns, so every section
        // would read as current at once.
        const skills = target.querySelector('[data-test="section-skills"]')
        expect(skills?.getAttribute('aria-current')).toBe('page')
        expect(target.querySelector('[data-test="section-catalogue"]')?.getAttribute('aria-current')).toBeNull()
    })

    it('unmount() removes the mounted Vue app from the DOM', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        await main.default.mount(target, makeHostContext())
        await new Promise((r) => setTimeout(r, 0))
        expect(target.querySelector('#spora-plugin-custom-skills')).not.toBeNull()
        main.default.unmount(target)
        expect(target.querySelector('#spora-plugin-custom-skills')).toBeNull()
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
        const first = target.querySelector('[data-test="home-page"]')
        expect(first).not.toBeNull()
        await main.default.mount(target, hostContext)
        await new Promise((r) => setTimeout(r, 0))
        const second = target.querySelector('[data-test="home-page"]')
        expect(second).not.toBeNull()
        expect(second).not.toBe(first)
    })
})
