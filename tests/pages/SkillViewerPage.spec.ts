/**
 * `SkillViewerPage` — `/library/:name`, the read-only view of a shipped skill.
 *
 * The page had no test at all until it grew the one thing it now owns: fetching a
 * sidecar. `show` inlines only the `SKILL.md` body and lists every other file as
 * `{path, bytes}`, so before the per-file endpoint existed there was nothing to
 * fetch and nothing to test — the panel could only ever show markdown, and that
 * read as a rendering limit rather than a missing route.
 *
 * What is pinned here: the read is per file and on demand, a failed read becomes a
 * stated outcome rather than a blank pane, and a request in flight says so instead
 * of rendering an empty editor.
 */
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
        // The reason is no longer "the host has no such endpoint" — that is fixed.
        expect(unavailable.text()).not.toContain('no per-file read')
        expect(wrapper.find('[data-test="source-editor"]').exists()).toBe(false)
    })

    it('does not carry a pending read across to the next skill', async () => {
        // A read that never answers must not leave the panel saying "Reading
        // <old path>" once a different skill is on screen.
        mocked.getPreShippedSkillFile.mockImplementation(() => new Promise(() => {}))
        const wrapper = await mountOn('code-review')
        await flushPromises()

        await wrapper.get(`[data-test="viewer-rail-file-${SIDECAR}"]`).trigger('click')
        await flushPromises()
        expect(wrapper.find('[data-test="viewer-contents-loading"]').exists()).toBe(true)

        mocked.getPreShippedSkill.mockResolvedValue(shippedWithSidecar('other'))
        await router.push('/library/other')
        await flushPromises()

        expect(wrapper.get('[data-test="viewer-title"]').text()).toBe('other')
        expect(wrapper.find('[data-test="viewer-contents-loading"]').exists()).toBe(false)
    })
})
