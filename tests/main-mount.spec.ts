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
import { flushPromises } from '@vue/test-utils'
import type { PluginHostContext } from '../src/shims'

/** The last host `get`, so a spec can assert on the query the panel actually sent. */
let get: ReturnType<typeof vi.fn>

/** A `custom_skills` row, field-for-field with the contract's frozen shape. */
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
    // `SkillsPage` fetches these four envelopes on mount; empty ones resolve
    // instead of blowing up with "Cannot read properties of undefined".
    get = vi.fn().mockImplementation((path: string) => {
        // Principals, so the scope bar has something to name and the layout can
        // resolve the acting principal the URL states.
        if (path === '/principals/me') {
            return Promise.resolve({
                principals: [
                    { id: 7, type: 'user', name: 'Maya Fischer', user_id: 3, group_id: null },
                    { id: 8, type: 'group', name: 'Studio', user_id: null, group_id: 2 },
                ],
            })
        }
        // Answering per principal is deliberate: a read sent with the *wrong*
        // `?principal_id=` has to fail, which is the bug this spec exists for.
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
            // `as never` because the vi.fn's `any` signature is wider than the host
            // client's generic one, which is a typing artefact of the mock rather
            // than a shape mismatch.
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

/**
 * The slice of the host's Vue Router this app touches.
 *
 * `afterEach` is a real Vue Router method the host exposes, so the fake fires the
 * same imperative callback the code registers rather than pretending to be
 * reactive — a `watch` on `currentRoute` would also "work" here and fail in the
 * host, which is the whole reason the code uses `afterEach`.
 */
/** The shape a host route arrives in, including vue-router's `failure` argument. */
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
        /** How many guards are currently registered — 1 while mounted, 0 after. */
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

    it('mount() opens the skill a host URL names, so a search hit lands on it', async () => {
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        hostContext.router = fakeHostRouter({ path: '/apps/custom-skills/p/7/skill/invoice-drafting' })

        await main.default.mount(target, hostContext)
        await flushPromises()

        // Without this the palette's link opened the panel's home page and dropped
        // the skill, because the host registers no child route for the path.
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

        // A shipped skill is global and read-only, so the host links it under
        // `/library/`. Collapsing both kinds onto the desk route would render the
        // viewer page under the writable route, and the scope bar would announce the
        // acting principal for a skill that has none.
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
        // The host router outlives the app, so a surviving listener would push into
        // a router whose element is gone — and the host remounts this bundle.
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
        // Duplicate navigates with `?template=`. Without the query the panel would be
        // unshareable and unreloadable for exactly that flow — the thing this PR claims
        // to fix — so the local -> host direction pushes `to.fullPath`, not `to.path`.
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

        // The create form reads `?template=` and fetches that shipped skill. Asserting
        // the fetch is a direct proof the query survived the host -> local hop;
        // `create-page` alone would pass with the query dropped.
        expect(target.querySelector('[data-test="create-page"]')).not.toBeNull()
        expect(get).toHaveBeenCalledWith('/skills/code-review')
    })

    it('ignores a cancelled host navigation instead of driving the panel', async () => {
        // vue-router fires `afterEach` for CANCELLED and aborted navigations too, so an
        // unguarded listener writes the path of a navigation that never happened — and
        // the host mirroring that stale path back overrides what the operator asked for.
        const main = await import('../src/main')
        const target = makeTarget()
        const hostContext = makeHostContext()
        const hostRouter = fakeHostRouter({ path: '/apps/custom-skills/p/7' })
        hostContext.router = hostRouter

        await main.default.mount(target, hostContext)
        await flushPromises()
        expect(target.querySelector('[data-test="home-page"]')).not.toBeNull()

        // `failure` is what vue-router passes for a superseded navigation.
        hostRouter.navigate(
            { path: '/apps/custom-skills/p/8/library' },
            new Error('Navigation aborted from...'),
        )
        await flushPromises()

        expect(target.querySelector('[data-test="catalogue-page"]')).toBeNull()
        expect(target.querySelector('[data-test="home-page"]')).not.toBeNull()
    })

    it('does not replace the local route when the host query is unchanged', async () => {
        // The echo guard compares path *and* query. A host navigation that only
        // reorders the query still means "already there"; replacing on it would churn
        // the local history for no reason. Mounted with the query already present, so
        // the navigation genuinely reorders rather than adds.
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
        // Each direction guards on "is the other side already there", so a host push
        // answering a local push must not push back. Asserted over a sequence rather
        // than a single hop: a two-step loop settles within one step.
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
        // Mount itself canonicalises the bare root, so start counting from here —
        // this asserts about what happens *after* the app is gone.
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
