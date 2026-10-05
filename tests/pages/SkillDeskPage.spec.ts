/**
 * `SkillDeskPage` — `/skills/:name`.
 *
 * The page's own job, on top of mounting the desk, is lifecycle: a save PUTs
 * without a name (the contract rejects a rename with 422), sidecar contents are
 * fetched on open so a save cannot blank the file set, a delete leaves the route
 * because the row is gone, a name that is not on this principal says so
 * instead of rendering an empty desk, and a name that belongs to the host
 * catalogue renders the same desk read-only.
 *
 * Two of its jobs need a page rather than the desk: the tool registry is read once
 * here and passed down, and the post-save declaration box needs the saved *response*
 * to say anything true. The box's tests are mostly about what it must not claim —
 * this page has no agent context, so a declaration is not an activation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { Router } from 'vue-router'
import SkillDeskPage from '../../src/pages/SkillDeskPage.vue'
import * as api from '../../src/api/customSkills'
import * as preshippedApi from '../../src/api/preshippedSkills'
import * as toolsApi from '../../src/api/tools'
import { ApiError } from '../../src/api/client'
import { useSkillsStore } from '../../src/stores/skills'
import { usePrincipalsStore } from '../../src/stores/principals'
import {
    makePrincipal,
    makePreShipped,
    makePreShippedDetail,
    makeSkill,
    makeTools,
    makeValidationEntry,
} from '../fixtures'
import { mountPage, stubRoutes } from '../mountPage'

vi.mock('../../src/api/customSkills')
vi.mock('../../src/api/preshippedSkills')
vi.mock('../../src/api/tools')

const mockedApi = vi.mocked(api)
const mockedPreShipped = vi.mocked(preshippedApi)
const mockedTools = vi.mocked(toolsApi)

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
    mockedTools.listTools.mockResolvedValue(makeTools())

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

    it('sends the read-only desk\u2019s Duplicate to the create form as a template', async () => {
        useSkillsStore().skills = []
        mockedApi.getSkill.mockRejectedValue(new Error('404 SKILL_NOT_FOUND'))
        mockedPreShipped.listPreShippedSkills.mockResolvedValue([makePreShipped()])
        mockedApi.createSkill.mockResolvedValue(makeSkill({ name: 'code-review-2' }))

        const wrapper = await mountOn('code-review')
        await flushPromises()

        await wrapper.get('[data-test="desk-duplicate"]').trigger('click')
        await flushPromises()

        // Nothing written from here either. The name is final, and a row created
        // for an operator who has not read the body yet is a row to delete.
        expect(mockedApi.createSkill).not.toHaveBeenCalled()
        expect(router.currentRoute.value.path).toBe('/new')
        expect(router.currentRoute.value.query.template).toBe('code-review')
    })

    it('keeps a custom skill editable, since the catalogue fallback must not leak', async () => {
        mockedPreShipped.listPreShippedSkills.mockResolvedValue([makePreShipped()])
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()

        expect(wrapper.get('[data-test="desk-state"]').text()).not.toBe('read-only')
        expect(wrapper.find('[data-test="desk-save"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="desk-duplicate"]').exists()).toBe(false)
    })

    it('returns to "saved" after a save, once the sidecar contents have landed', async () => {
        // The reported symptom end to end: a skill with a sidecar read as
        // "unsaved changes" permanently, and saving it changed nothing. The contents
        // arrive in a second request, so this only reproduces through the page.
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('saved')

        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Rewritten')
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('unsaved changes')

        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()

        expect(mockedApi.updateSkill).toHaveBeenCalled()
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('saved')
    })

    it('fetches the sidecar contents, because save replaces the file set wholesale', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        expect(mockedApi.getSkillFile).toHaveBeenCalledWith(
            'invoice-drafting',
            'examples/invoice.md',
            7,
        )
        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')
        expect((wrapper.get('[data-testid="md-editor-stub"]').element as HTMLTextAreaElement).value).toBe('# Example')
    })

    it('leaves an unreadable sidecar blank rather than pretending it loaded', async () => {
        // 413 over the 50 000-byte cap, or removed underneath us. The manifest still
        // lists the path, so the rail is right and the save-time error is the signal.
        mockedApi.getSkillFile.mockRejectedValue(new Error('413 FILE_TOO_LARGE'))
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')
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

/**
 * The post-save declaration box.
 *
 * Declaration-only, and that boundary is the point. The page has no agent context,
 * so it can report what the server now holds and which of those names this instance
 * can resolve — and nothing about whether any agent has them. The activation gap
 * belongs to the host's per-agent Tools page, which does have that context.
 */
describe('SkillDeskPage → the post-save declaration box', () => {
    it('is absent before any save, since there is nothing to report yet', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        expect(wrapper.find('[data-test="declared-tools-summary"]').exists()).toBe(false)
    })

    it('names the tools the saved skill declares, and marks the unresolvable one', async () => {
        mockedApi.updateSkill.mockResolvedValue(
            makeSkill({ allowed_tools: 'agent legacy_erp_export', updated_at: '2026-09-30 15:00:00' }),
        )
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Changed')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()

        const box = wrapper.get('[data-test="declared-tools-summary"]')
        // A live region, not a toast: a toast is gone before a declaration has
        // been read, and the names live in a checkbox group the reader just closed.
        // The element itself carries the semantics, so this pins `output` rather
        // than a `role` attribute that only some assistive tech honours.
        expect(box.element.tagName).toBe('OUTPUT')
        expect(box.get('[data-test="declared-tools-count"]').text()).toBe('2 tools')

        // One resolvable, one not — and the marking has to land on the right one.
        // A note on `agent` would be a false claim about this instance, which is the
        // only thing the marking is for.
        const available = box.findAll('[data-test="declared-tool"]')
        expect(available).toHaveLength(1)
        expect(available[0]?.text()).toContain('agent')
        expect(available[0]?.text()).not.toContain('not available')
        expect(available[0]?.find('[data-test="declared-tool-unavailable-note"]').exists()).toBe(false)

        const unavailable = box.get('[data-test="declared-tool-unavailable"]')
        expect(unavailable.text()).toContain('legacy_erp_export')
        expect(unavailable.text()).toContain('not available on this instance')
        // Named separately, so "one of these does not resolve" is not something the
        // operator has to spot by reading the list.
        expect(box.get('[data-test="declared-tools-unavailable-note"]').text()).toContain('1 name resolves to no tool')
    })

    it('says the skill declares no tools when the save cleared them', async () => {
        mockedApi.updateSkill.mockResolvedValue(
            makeSkill({ allowed_tools: null, updated_at: '2026-09-30 15:00:00' }),
        )
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Changed')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()

        expect(wrapper.get('[data-test="declared-tools-none"]').text()).toContain('declares no tools')
    })

    it('says nothing about activation, because this page cannot know it', async () => {
        // The claim this surface must not make. A reader who has just saved a
        // declaration is exactly the person who will assume it is live, so the box
        // has to state the limit rather than leave it to be assumed.
        mockedApi.updateSkill.mockResolvedValue(
            makeSkill({ allowed_tools: 'agent', updated_at: '2026-09-30 15:00:00' }),
        )
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Changed')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()

        const box = wrapper.get('[data-test="declared-tools-summary"]')
        const text = box.text().toLowerCase()
        // No word here may assert that a tool is on, enabled, activated or approved
        // for an agent — the page has no agent to have checked.
        expect(text).not.toMatch(/\b(is|are|now) (active|enabled|activated|approved|granted|on)\b/)
        expect(text).not.toMatch(/agents? (can|will|has|have) (now )?use/)
        expect(text).not.toMatch(/in use|already enabled|is live/)
        // The honest scope, stated rather than implied.
        expect(box.get('[data-test="declared-tools-scope"]').text()).toContain('grants no pre-approval')
        expect(box.get('[data-test="declared-tools-scope"]').text()).toContain('set per agent')
    })

    it('does not link to the host Tools page, because this plugin has no route there', async () => {
        mockedApi.updateSkill.mockResolvedValue(
            makeSkill({ allowed_tools: 'agent', updated_at: '2026-09-30 15:00:00' }),
        )
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Changed')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()

        // An activation-gap message the desk points at would be a dead link: the
        // panel owns three routes and none of them is an agent's tools.
        const box = wrapper.get('[data-test="declared-tools-summary"]')
        expect(box.findAll('a')).toHaveLength(0)
    })

    it('reports the server’s stored value rather than the draft, so it cannot describe an unsaved edit', async () => {
        // An author who unchecks a box and closes the tab has saved nothing; the box
        // must not claim a declaration that was never written.
        mockedApi.updateSkill.mockResolvedValue(
            makeSkill({ allowed_tools: 'agent', updated_at: '2026-09-30 15:00:00' }),
        )
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-test="tool-option-agent"] input').setValue(false)
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()

        // The store row the page renders is the response, and the response still
        // carries `agent` — the mock stands in for a server that kept the value.
        expect(wrapper.get('[data-test="declared-tool"]').text()).toContain('agent')
    })

    it('shows nothing after a rejected save, because nothing was stored', async () => {
        mockedApi.updateSkill.mockRejectedValue(new ApiError('Skill is invalid.', 'SKILL_INVALID', 422))
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Changed')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()

        expect(wrapper.find('[data-test="declared-tools-summary"]').exists()).toBe(false)
    })
})

describe('SkillDeskPage → the tool registry', () => {
    it('reads the instance registry once and passes it to the desk', async () => {
        mockedTools.listTools.mockResolvedValue(makeTools())
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()

        expect(mockedTools.listTools).toHaveBeenCalledTimes(1)
        expect(wrapper.findAll('[data-test^="tool-option-"]').length).toBeGreaterThan(0)
    })

    it('still shows the declaration when the registry read fails', async () => {
        // An aid that will not load must not make the field uneditable or hide what
        // the skill declares. A failed read is carried as "not read" rather than as
        // an empty instance, so no name is falsely reported as absent.
        mockedTools.listTools.mockRejectedValue(new Error('500'))
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()

        // `makeSkill()` declares `agent read_url`.
        expect(wrapper.findAll('[data-test^="tool-option-"]')).toHaveLength(2)
        expect(wrapper.get('[data-test="tool-option-read_url"] input').attributes('disabled')).toBeUndefined()
        expect(wrapper.find('[data-test="tool-unavailable-note"]').exists()).toBe(false)
    })

    it("carries a shipped skill's declaration onto the read-only desk", async () => {
        // `deskShape` has no `updated_at` to give, and the reload guard used to read
        // "never loaded" as the empty string — the same value it reads as "already
        // loaded", because a shipped shape's timestamp is `''`. So the first load of
        // a shipped skill was skipped and its frontmatter never reached the desk.
        // The declaration is the most visible thing that was lost with it.
        useSkillsStore().skills = []
        mockedApi.getSkill.mockRejectedValue(new Error('404 SKILL_NOT_FOUND'))
        mockedPreShipped.listPreShippedSkills.mockResolvedValue([makePreShipped()])
        mockedPreShipped.getPreShippedSkill.mockResolvedValue(
            makePreShippedDetail({ allowed_tools: 'typst_compile' }),
        )

        const wrapper = await mountOn('code-review')
        await flushPromises()

        // Otherwise the field would read empty on a shipped skill that declares
        // tools, which is the one case where an author most needs to see it.
        expect(wrapper.find('[data-test="tool-option-typst_compile"]').exists()).toBe(true)
        expect(wrapper.get('[data-test="tool-option-typst_compile"] input').attributes('disabled')).toBeDefined()
    })

    it('loads a shipped skill’s frontmatter at all, which the empty timestamp used to suppress', async () => {
        // The whole buffer, not just this field: a shipped skill opened on this route
        // rendered its frontmatter empty, so "duplicate this and edit it" started
        // from nothing.
        useSkillsStore().skills = []
        mockedApi.getSkill.mockRejectedValue(new Error('404 SKILL_NOT_FOUND'))
        mockedPreShipped.listPreShippedSkills.mockResolvedValue([makePreShipped()])

        const wrapper = await mountOn('code-review')
        await flushPromises()

        expect((wrapper.get('[data-test="field-description"]').element as HTMLTextAreaElement).value)
            .toBe('House rules for reviewing a diff.')
        expect((wrapper.get('[data-test="field-license"]').element as HTMLInputElement).value).toBe('MIT')
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
