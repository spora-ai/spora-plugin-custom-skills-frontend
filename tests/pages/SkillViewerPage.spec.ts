/** `SkillViewerPage` — `/library/:name`. Pins that a sidecar is fetched when
 * opened, that a failed read is stated rather than blank, and that a read cannot
 * leak across a skill change. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { Router } from 'vue-router'
import SkillViewerPage from '../../src/pages/SkillViewerPage.vue'
import * as preshippedApi from '../../src/api/preshippedSkills'
import { ApiError } from '../../src/api/client'
import { makePreShippedDetail } from '../fixtures'
import { mountPage, stubRoutes } from '../mountPage'

vi.mock('../../src/api/preshippedSkills')

const mocked = vi.mocked(preshippedApi)

let pinia: Pinia
let router: Router

async function mountOn(name = 'code-review') {
    router = stubRoutes()
    await router.push(`/library/${name}`)
    await router.isReady()
    return mountPage(SkillViewerPage, pinia, router)
}

const SIDECAR = 'templates/report.typ'

/** A shipped skill that actually has a sidecar, which the shared fixture omits. */
function shippedWithSidecar(name = 'code-review') {
    return makePreShippedDetail({
        name,
        files: [
            { path: 'SKILL.md', bytes: 10 },
            { path: SIDECAR, bytes: 21 },
        ],
    })
}

beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    mocked.getPreShippedSkill.mockResolvedValue(shippedWithSidecar())
    mocked.getPreShippedSkillFile.mockResolvedValue({
        path: SIDECAR,
        content: '#let title = "Report"',
        bytes: 21,
    })
})

describe('SkillViewerPage → sidecar contents', () => {
    it('fetches a sidecar when it is opened, not up front', async () => {
        // Per file, so a skill with a dozen sidecars does not transfer a dozen
        // files to show one, and a file over the cap fails on its own.
        const wrapper = await mountOn()
        await flushPromises()

        expect(mocked.getPreShippedSkillFile).not.toHaveBeenCalled()

        await wrapper.get(`[data-test="viewer-rail-file-${SIDECAR}"]`).trigger('click')
        await flushPromises()

        expect(mocked.getPreShippedSkillFile).toHaveBeenCalledWith('code-review', SIDECAR)
        expect(wrapper.find('[data-test="source-editor"]').exists()).toBe(true)
    })

    it('says a failed read could not be shown, rather than rendering a blank pane', async () => {
        mocked.getPreShippedSkillFile.mockRejectedValue(
            new ApiError('no such file', 'SKILL_FILE_NOT_FOUND', 404),
        )
        const wrapper = await mountOn()
        await flushPromises()

        await wrapper.get(`[data-test="viewer-rail-file-${SIDECAR}"]`).trigger('click')
        await flushPromises()

        const unavailable = wrapper.get('[data-test="viewer-contents-unavailable"]')
        expect(unavailable.text()).toContain(SIDECAR)
        expect(unavailable.text()).toContain('could not be read')
        expect(unavailable.text()).not.toContain('no per-file read')
        expect(wrapper.find('[data-test="source-editor"]').exists()).toBe(false)
    })

    it('discards a read that lands after the route changed', async () => {
        // Both skills carry the same sidecar path, so a stale write would render
        // the first skill's bytes under the second skill's heading. The read
        // RESOLVES late on purpose: a mock that never settles never reaches the
        // write, so it would pass with the guard absent.
        let release: (v: { path: string; content: string; bytes: number }) => void = () => {}
        mocked.getPreShippedSkillFile
            .mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
            .mockResolvedValue({ path: SIDECAR, content: 'FRESH FROM OTHER', bytes: 15 })

        const wrapper = await mountOn('code-review')
        await flushPromises()
        await wrapper.get(`[data-test="viewer-rail-file-${SIDECAR}"]`).trigger('click')
        await flushPromises()

        mocked.getPreShippedSkill.mockResolvedValue(shippedWithSidecar('other'))
        await router.push('/library/other')
        await flushPromises()

        release({ path: SIDECAR, content: 'STALE FROM THE PREVIOUS SKILL', bytes: 30 })
        await flushPromises()

        // The route change remounts the viewer on SKILL.md, so the stale bytes are
        // not on screen yet — the damage only shows when the path is opened here.
        await wrapper.get(`[data-test="viewer-rail-file-${SIDECAR}"]`).trigger('click')
        await flushPromises()

        // Without the guard the map already holds the stale contents, the viewer's
        // already-loaded check skips the request, and the old skill is rendered.
        expect(mocked.getPreShippedSkillFile).toHaveBeenCalledTimes(2)
        expect(wrapper.text()).toContain('FRESH FROM OTHER')
        expect(wrapper.text()).not.toContain('STALE FROM THE PREVIOUS SKILL')
    })

    it('treats a 200 with no body as refused, not as still loading', async () => {
        // Storing `{path: undefined}` would leave the viewer waiting on a path it
        // has already asked for, so it would say "Reading…" for ever.
        mocked.getPreShippedSkillFile.mockResolvedValue(
            undefined as unknown as { path: string; content: string; bytes: number },
        )
        const wrapper = await mountOn()
        await flushPromises()

        await wrapper.get(`[data-test="viewer-rail-file-${SIDECAR}"]`).trigger('click')
        await flushPromises()

        expect(wrapper.get('[data-test="viewer-contents-unavailable"]').text()).toContain('could not be read')
        expect(wrapper.find('[data-test="viewer-contents-loading"]').exists()).toBe(false)
    })
})
