/**
 * `SkillDeskPage` — `/skills/:name`.
 *
 * The page's own job, on top of mounting the desk, is lifecycle: a save PUTs
 * without a name (the contract rejects a rename with 422), sidecar contents are
 * fetched on open so a save cannot blank the file set, a delete leaves the route
 * because the row is gone, a name that is not on this principal says so
 * instead of rendering an empty desk, and a name that belongs to the host
 * catalogue renders the same desk read-only.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { Router } from 'vue-router'
import SkillDeskPage from '../../src/pages/SkillDeskPage.vue'
import * as api from '../../src/api/customSkills'
import * as preshippedApi from '../../src/api/preshippedSkills'
import { ApiError } from '../../src/api/client'
import { useSkillsStore } from '../../src/stores/skills'
import { usePrincipalsStore } from '../../src/stores/principals'
import {
    makePrincipal,
    makePreShipped,
    makePreShippedDetail,
    makeSkill,
    makeValidationEntry,
} from '../fixtures'
import { mountPage, stubRoutes } from '../mountPage'

vi.mock('../../src/api/customSkills')
vi.mock('../../src/api/preshippedSkills')

const mockedApi = vi.mocked(api)
const mockedPreShipped = vi.mocked(preshippedApi)

let pinia: Pinia
let router: Router

async function mountOn(name: string) {
    router = stubRoutes()
    await router.push(`/skills/${name}`)
    await router.isReady()
    return mountPage(SkillDeskPage, pinia, router)
}

beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    mockedApi.getSkill.mockResolvedValue(makeSkill())
    mockedApi.getSkillFile.mockResolvedValue({ path: 'examples/invoice.md', content: '# Example', bytes: 9 })
    mockedApi.updateSkill.mockResolvedValue(makeSkill({ body: '# Changed', updated_at: '2026-09-30 15:00:00' }))
    mockedApi.restoreSkill.mockResolvedValue(makeSkill({ has_previous: false, body: '# Old' }))
    mockedPreShipped.listPreShippedSkills.mockResolvedValue([])
    mockedPreShipped.getPreShippedSkill.mockResolvedValue(makePreShippedDetail())

    const principals = usePrincipalsStore()
    principals.principals = [makePrincipal()]
    principals.selectedPrincipalId = 7
    useSkillsStore().skills = [makeSkill()]
})

describe('SkillDeskPage → opening', () => {
    it('renders the desk for the named skill', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('invoice-drafting')
        // The store already had the row, so no second read is needed.
        expect(mockedApi.getSkill).not.toHaveBeenCalled()
    })

    it('reads a skill the store does not hold, for a deep link', async () => {
        useSkillsStore().skills = []
        const wrapper = await mountOn('expense-policy')
        await flushPromises()
        expect(mockedApi.getSkill).toHaveBeenCalledWith('expense-policy', 7)
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('invoice-drafting')
    })

    it('says so when the principal has no such skill, rather than an empty desk', async () => {
        useSkillsStore().skills = []
        mockedApi.getSkill.mockRejectedValue(new Error('404 SKILL_NOT_FOUND'))
        const wrapper = await mountOn('nope')
        await flushPromises()
        expect(mockedPreShipped.listPreShippedSkills).toHaveBeenCalled()
        expect(wrapper.get('[data-test="desk-missing"]').text()).toContain('No skill named “nope”')
        expect(wrapper.find('[data-test="skill-desk"]').exists()).toBe(false)
    })

    it('renders a shipped skill read-only instead of claiming it does not exist', async () => {
        // A shipped skill has no row on any principal, so the custom read 404s
        // for a name that very much exists. Answering "no skill named X" there is
        // the confusing case worth avoiding.
        useSkillsStore().skills = []
        mockedApi.getSkill.mockRejectedValue(new Error('404 SKILL_NOT_FOUND'))
        mockedPreShipped.listPreShippedSkills.mockResolvedValue([makePreShipped()])

        const wrapper = await mountOn('code-review')
        await flushPromises()

        expect(mockedPreShipped.getPreShippedSkill).toHaveBeenCalledWith('code-review')
        expect(wrapper.find('[data-test="desk-missing"]').exists()).toBe(false)
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('code-review')
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('read-only')
    })

    it('offers no way to write a shipped skill, and offers Duplicate instead', async () => {
        useSkillsStore().skills = []
        mockedApi.getSkill.mockRejectedValue(new Error('404 SKILL_NOT_FOUND'))
        mockedPreShipped.listPreShippedSkills.mockResolvedValue([makePreShipped()])

        const wrapper = await mountOn('code-review')
        await flushPromises()

        expect(wrapper.find('[data-test="desk-save"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="desk-delete"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="desk-restore"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="desk-duplicate"]').exists()).toBe(true)
        expect(wrapper.get('[data-testid="md-editor-stub"]').attributes('readonly')).toBeDefined()
        expect(wrapper.get('[data-test="desk-readonly-note"]').text()).toContain('core')
    })

    it('duplicates a shipped skill onto the principal and opens the copy', async () => {
        useSkillsStore().skills = []
        mockedApi.getSkill.mockRejectedValue(new Error('404 SKILL_NOT_FOUND'))
        mockedPreShipped.listPreShippedSkills.mockResolvedValue([makePreShipped()])
        mockedApi.createSkill.mockResolvedValue(makeSkill({ name: 'code-review-2' }))

        const wrapper = await mountOn('code-review')
        await flushPromises()

        await wrapper.get('[data-test="desk-duplicate"]').trigger('click')
        await flushPromises()

        expect(mockedApi.createSkill).toHaveBeenCalled()
        expect(router.currentRoute.value.path).toBe('/skills/code-review-2')
    })

    it('keeps a custom skill editable, since the catalogue fallback must not leak', async () => {
        mockedPreShipped.listPreShippedSkills.mockResolvedValue([makePreShipped()])
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()

        expect(wrapper.get('[data-test="desk-state"]').text()).not.toBe('read-only')
        expect(wrapper.find('[data-test="desk-save"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="desk-duplicate"]').exists()).toBe(false)
    })

    it('fetches the sidecar contents, because save replaces the file set wholesale', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        expect(mockedApi.getSkillFile).toHaveBeenCalledWith(
            'invoice-drafting',
            'examples/invoice.md',
            7,
        )
        await wrapper.findAll('[data-test="rail-file"]')[0]?.trigger('click')
        expect((wrapper.get('[data-testid="md-editor-stub"]').element as HTMLTextAreaElement).value).toBe('# Example')
    })

    it('leaves an unreadable sidecar blank rather than pretending it loaded', async () => {
        // 413 over the 50 000-byte cap, or removed underneath us. The manifest still
        // lists the path, so the rail is right and the save-time error is the signal.
        mockedApi.getSkillFile.mockRejectedValue(new Error('413 FILE_TOO_LARGE'))
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.findAll('[data-test="rail-file"]')[0]?.trigger('click')
        expect((wrapper.get('[data-testid="md-editor-stub"]').element as HTMLTextAreaElement).value).toBe('')
    })

    it('names the principal in the footer, because the URL does not', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        expect(wrapper.get('[data-test="desk-footer"]').text()).toContain('Maya Fischer')
    })
})

describe('SkillDeskPage → saving', () => {
    it('PUTs the change without a name', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Changed')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()

        expect(mockedApi.updateSkill).toHaveBeenCalledWith(
            'invoice-drafting',
            7,
            expect.objectContaining({ body: '# Changed' }),
        )
        const payload = mockedApi.updateSkill.mock.calls[0]?.[2] as Record<string, unknown>
        expect(payload).not.toHaveProperty('name')
    })

    it('keeps the buffer after a rejection, so a 422 does not cost the work', async () => {
        mockedApi.updateSkill.mockRejectedValue(
            Object.assign(new ApiError('Skill is invalid.', 'SKILL_INVALID', 422), {
                data: { errors: [makeValidationEntry({ code: 'BODY_TOO_LONG', message: 'too long', path: 'body' })] },
            }),
        )
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Changed')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()

        expect(useSkillsStore().error).toBe('Skill is invalid.')
        expect((wrapper.get('[data-testid="md-editor-stub"]').element as HTMLTextAreaElement).value).toBe('# Changed')
    })

    it('announces a saved-with-warnings result', async () => {
        mockedApi.updateSkill.mockResolvedValue(
            makeSkill({ warning_count: 1, updated_at: '2026-09-30 15:00:00' }),
        )
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Changed')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()
        expect(useSkillsStore().notice).toContain('Saved with 1 warning')
    })

    it('restores the previous version and says so', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-test="desk-restore"]').trigger('click')
        await flushPromises()
        expect(mockedApi.restoreSkill).toHaveBeenCalledWith('invoice-drafting', 7)
        expect(useSkillsStore().notice).toBe('Restored the previous version of invoice-drafting.')
    })
})

describe('SkillDeskPage → leaving', () => {
    it('goes home on cancel', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-test="desk-cancel"]').trigger('click')
        await flushPromises()
        expect(router.currentRoute.value.path).toBe('/')
    })

    it('raises the delete confirmation through the store', async () => {
        mockedApi.getSkillAllowlist.mockResolvedValue([
            { id: 5, name: 'Invoicer', scope: 'agent' },
        ])
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-test="desk-menu-trigger"]').trigger('click')
        await wrapper.get('[data-test="desk-delete"]').trigger('click')
        await flushPromises()
        expect(useSkillsStore().pendingDelete).toBe('invoice-drafting')
        expect(useSkillsStore().deleteBlastRadius).toEqual(['Invoicer'])
    })

    it('leaves the desk once the row is gone, since there is nothing left to write', async () => {
        const store = useSkillsStore()
        await mountOn('invoice-drafting')
        await flushPromises()
        mockedApi.deleteSkill.mockResolvedValue({
            deleted: true,
            name: 'invoice-drafting',
            scrubbed_agents: [],
        })
        mockedApi.getSkillAllowlist.mockResolvedValue([])

        await store.requestDelete('invoice-drafting')
        // The layout owns the dialog, so it owns the navigation: the desk does not
        // infer "deleted" from the row disappearing, which a principal change would
        // also cause.
        expect(await store.confirmDelete()).toBe('invoice-drafting')
        await flushPromises()

        expect(store.skills).toHaveLength(0)
    })

    it('does not treat a list reload as a delete and bounce the operator off the desk', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        // A principal change replaces the whole list, so the open skill briefly
        // disappears from it. Navigating away here would lose a half-written body.
        useSkillsStore().skills = [makeSkill({ name: 'other', principal_id: 8 })]
        await flushPromises()
        expect(router.currentRoute.value.path).toBe('/skills/invoice-drafting')
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('invoice-drafting')
    })

    it('follows the operator to another skill without a reload', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        useSkillsStore().skills = [makeSkill({ name: 'expense-policy' })]
        await router.push('/skills/expense-policy')
        await flushPromises()
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('expense-policy')
    })
})
