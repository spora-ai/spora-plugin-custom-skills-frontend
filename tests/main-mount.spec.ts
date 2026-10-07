/** Mount/unmount contract for `src/main.ts → SporaApp`, end-to-end against a fake DOM target. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { PluginHostContext } from '../src/shims'

let get: ReturnType<typeof vi.fn>

function makeRemoteSkill(principalId: number, name: string): Record<string, unknown> {
    return {
        id: 1,
        principal_id: principalId,
        name,
        slug: name,
        description: '',
        license: null,
        compatibility: null,
        allowed_tools: null,
        metadata: {},
        body: '',
        body_bytes: 0,
        provenance: 'human',
        created_by_user_id: 3,
        updated_by_user_id: 3,
        created_at: '',
        updated_at: '',
        files: [],
        has_previous: false,
        previous_at: null,
        previous_by: null,
        warnings: [],
        warning_count: 0,
    }
}

function makeHostContext(): PluginHostContext {
    get = vi.fn().mockImplementation((path: string) => {
        if (path === '/principals/me') {
            return Promise.resolve({
                principals: [
                    { id: 7, type: 'user', name: 'Maya Fischer', user_id: 3, group_id: null },
                    { id: 8, type: 'group', name: 'Studio', user_id: null, group_id: 2 },
                ],
            })
        }
        // Answering per principal is deliberate: a read with the *wrong* `?principal_id=` must fail.
        const principalOf = (p: string) => Number(/principal_id=(\d+)/.exec(p)?.[1])
        if (path.startsWith('/custom-skills?')) {
            return Promise.resolve({
                skills: principalOf(path) === 8 ? [makeRemoteSkill(8, 'test')] : [],
            })
        }
        if (path === '/custom-skills') return Promise.resolve({ skills: [] })
        if (path.startsWith('/custom-skills/')) {
            const name = decodeURIComponent(path.slice('/custom-skills/'.length).split('?')[0] ?? '')
            if (principalOf(path) !== 8 || name !== 'test') {
                return Promise.reject(new Error('404 SKILL_NOT_FOUND'))
            }
            return Promise.resolve({ skill: makeRemoteSkill(8, 'test') })
        }
        if (path === '/skills') return Promise.resolve({ skills: [] })
        if (path === '/agents') return Promise.resolve({ agents: [] })
        return Promise.resolve(undefined)
    })
    return {
        api: {
            // `as never`: the vi.fn's `any` signature is wider than the host client's — a mock artefact.
            get: get as never,
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

/** The slice of the host's Router this app touches. A `watch` on `currentRoute` would "work" here
 *  and fail in the host, which is why the fake exposes `afterEach`. */
type HostRouteArg = {
    path: string
    fullPath?: string
    query?: Record<string, unknown>
}

function fakeHostRouter(initial: { path: string; query?: Record<string, unknown> }) {
    let guard: ((to: HostRouteArg, from: unknown, failure?: unknown) => void) | null = null

    return {
        currentRoute: { value: { ...initial } as { path: string; query?: Record<string, unknown> } },
        push: vi.fn().mockResolvedValue(undefined),
        /** Guards currently registered: 1 while mounted, 0 after. */
        get registered(): number {
            return guard === null ? 0 : 1
        },
        afterEach(cb: (to: HostRouteArg, from: unknown, failure?: unknown) => void): () => void {
            guard = cb
            return () => {
                if (guard === cb) guard = null
            }
        },
        navigate(to: { path: string; query?: Record<string, unknown> }, failure?: unknown): void {
            this.currentRoute.value = { ...to }
            guard?.(to, undefined, failure)
        },
    }
}

beforeEach(() => {
    document.body.innerHTML = ''
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
        // Loses it and the plugin CSS unscopes into the host.
        expect(target.querySelector('#spora-plugin-custom-skills')).not.toBeNull()
        expect(target.querySelector('[data-test="home-page"]')).not.toBeNull()
    })

    it('mount() opens the skill a host URL names, so a search hit lands on it', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        hostContext.router = fakeHostRouter({ path: '/apps/custom-skills/p/7/skill/invoice-drafting' })

        await main.default.mount(target, hostContext)
        await flushPromises()

        // Without the child route the host registers for this path, a palette's link opened home.
        expect(target.querySelector('[data-test="desk-page"]')).not.toBeNull()
        expect(target.querySelector('[data-test="home-page"]')).toBeNull()
    })

    it('mount() opens a group-owned skill under the principal its URL names', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        hostContext.router = fakeHostRouter({ path: '/apps/custom-skills/p/8/skill/test' })

        await main.default.mount(target, hostContext)
        await flushPromises()

        expect(get).toHaveBeenCalledWith('/custom-skills/test?principal_id=8')
        expect(target.querySelector('[data-test="desk-missing"]')).toBeNull()
    })

    it('mount() follows a pre-principal href, so an older bookmark still opens', async () => {
        
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        hostContext.router = fakeHostRouter({ path: '/apps/custom-skills/skill/invoice-drafting' })

        await main.default.mount(target, hostContext)
        await flushPromises()

        expect(target.querySelector('[data-test="desk-page"]')).not.toBeNull()
    })

    it('mount() lands a /library/ host URL on the read-only viewer, not the desk', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        hostContext.router = fakeHostRouter({ path: '/apps/custom-skills/p/7/library/time-arithmetic' })

        await main.default.mount(target, hostContext)
        await flushPromises()

        // Collapsing both kinds onto the desk route would render the viewer under the writable one, and
        // the scope bar would announce a principal a shipped skill does not have.
        expect(target.querySelector('[data-test="viewer-page"]')).not.toBeNull()
        expect(target.querySelector('[data-test="desk-page"]')).toBeNull()
        expect(target.querySelector('[data-test="section-catalogue"]')?.getAttribute('aria-current')).toBe('page')
        expect(target.querySelector('[data-test="section-skills"]')?.getAttribute('aria-current')).toBeNull()
    })

    it('follows a later host navigation, and unregisters the listener on unmount', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        const hostRouter = fakeHostRouter({ path: '/apps/custom-skills' })
        hostContext.router = hostRouter

        await main.default.mount(target, hostContext)
        await flushPromises()
        expect(hostRouter.registered).toBe(1)

        hostRouter.navigate({ path: '/apps/custom-skills/p/8/skill/report' })
        await flushPromises()
        expect(target.querySelector('[data-test="desk-page"]')).not.toBeNull()
        expect(target.querySelector('[data-test="home-page"]')).toBeNull()

        main.default.unmount(target)
        // A surviving listener would push into a router whose element is gone.
        expect(hostRouter.registered).toBe(0)
    })

    it('writes the host URL when the panel navigates', async () => {

        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        const hostRouter = fakeHostRouter({ path: '/apps/custom-skills' })
        hostContext.router = hostRouter

        await main.default.mount(target, hostContext)
        await flushPromises()

        const catalogue = target.querySelector<HTMLAnchorElement>('[data-test="section-catalogue"]')
        expect(catalogue).not.toBeNull()
        catalogue!.click()
        await flushPromises()

        expect(hostRouter.push).toHaveBeenCalledWith('/apps/custom-skills/p/7/library')
    })

    it('carries the query string into the host URL', async () => {
        // Duplicate navigates with `?template=`; without the query that page is neither shareable nor
        // reloadable.
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        const hostRouter = fakeHostRouter({ path: '/apps/custom-skills' })
        hostContext.router = hostRouter

        await main.default.mount(target, hostContext)
        await flushPromises()
        hostRouter.push.mockClear()

        const viewer = target.querySelector<HTMLAnchorElement>('[data-test="section-catalogue"]')
        viewer!.click()
        await flushPromises()
        const newSkill = target.querySelector<HTMLAnchorElement>('[data-test="new-skill"]')
        newSkill!.click()
        await flushPromises()

        expect(hostRouter.push).toHaveBeenLastCalledWith('/apps/custom-skills/p/7/new')
    })

    it('carries the query string back in from a host navigation', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        const hostRouter = fakeHostRouter({ path: '/apps/custom-skills' })
        hostContext.router = hostRouter

        await main.default.mount(target, hostContext)
        await flushPromises()

        hostRouter.navigate({
            path: '/apps/custom-skills/p/7/new',
            query: { template: 'code-review' },
        })
        await flushPromises()

        // The assertion proves the query survived; `create-page` alone would pass with it dropped.
        expect(target.querySelector('[data-test="create-page"]')).not.toBeNull()
        expect(get).toHaveBeenCalledWith('/skills/code-review')
    })

    it('ignores a cancelled host navigation instead of driving the panel', async () => {
        // vue-router fires `afterEach` for CANCELLED too, so an unguarded listener writes a path
        // that never happened, which the host then mirrors straight back.
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        const hostRouter = fakeHostRouter({ path: '/apps/custom-skills/p/7' })
        hostContext.router = hostRouter

        await main.default.mount(target, hostContext)
        await flushPromises()
        expect(target.querySelector('[data-test="home-page"]')).not.toBeNull()

        hostRouter.navigate(
            { path: '/apps/custom-skills/p/8/library' },
            new Error('Navigation aborted from...'),
        )
        await flushPromises()

        expect(target.querySelector('[data-test="catalogue-page"]')).toBeNull()
        expect(target.querySelector('[data-test="home-page"]')).not.toBeNull()
    })

    it('does not replace the local route when the host query is unchanged', async () => {
        // The echo guard compares path *and* query; a reorder still means "already there".
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        const hostRouter = fakeHostRouter({
            path: '/apps/custom-skills/p/7/library',
            query: { a: '1', b: '2' },
        })
        hostContext.router = hostRouter

        await main.default.mount(target, hostContext)
        await flushPromises()
        expect(target.querySelector('[data-test="catalogue-page"]')).not.toBeNull()

        const before = hostRouter.push.mock.calls.length
        hostRouter.navigate({
            path: '/apps/custom-skills/p/7/library',
            query: { b: '2', a: '1' },
        })
        await flushPromises()

        expect(hostRouter.push.mock.calls.length).toBe(before)
    })

    it('does not ping-pong between the two routers', async () => {
        // A sequence, not a single hop: a two-step loop settles within one step.
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        const hostRouter = fakeHostRouter({ path: '/apps/custom-skills' })
        hostContext.router = hostRouter

        await main.default.mount(target, hostContext)
        await flushPromises()
        const afterMount = hostRouter.push.mock.calls.length

        for (const testId of ['section-catalogue', 'section-skills', 'new-skill']) {
            const link = target.querySelector<HTMLAnchorElement>(`[data-test="${testId}"]`)
            expect(link).not.toBeNull()
            link!.click()
            await flushPromises()
        }

        // One push per navigation the operator made — no extras from the echo.
        expect(hostRouter.push.mock.calls.length - afterMount).toBe(3)
        expect(hostRouter.push).toHaveBeenLastCalledWith('/apps/custom-skills/p/7/new')
    })

    it('does not push into the host router after unmount', async () => {

        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        const hostRouter = fakeHostRouter({ path: '/apps/custom-skills' })
        hostContext.router = hostRouter

        await main.default.mount(target, hostContext)
        await flushPromises()
        // Mount canonicalises the bare root, so count from here.
        hostRouter.push.mockClear()
        main.default.unmount(target)

        hostRouter.navigate({ path: '/apps/custom-skills/p/8/library' })
        await flushPromises()

        expect(hostRouter.push).not.toHaveBeenCalled()
    })

    it('mount() wires hostContext.api into the plugin-local api/client bridge', async () => {
        const main = await import('../src/main')
        const client = await import('../src/api/client')
        const target = makeTarget()
        const hostContext = makeHostContext()
        await main.default.mount(target, hostContext)

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
        // An unbound router leaves the scope bar on `START_LOCATION`, so every section reads as current.
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
