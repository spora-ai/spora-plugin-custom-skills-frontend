/**
 * `SkillDeskPage`. Beyond mounting the desk its job is lifecycle: a save PUTs without a name (the
 * contract rejects a rename with 422), sidecars are fetched on open, and a catalogue name renders
 * the same desk read-only.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { Router } from 'vue-router'
import SkillDeskPage from '../../src/pages/SkillDeskPage.vue'
import * as api from '../../src/api/customSkills'
import * as preshippedApi from '../../src/api/preshippedSkills'
import * as toolsApi from '../../src/api/tools'
import * as principalsApi from '../../src/api/principals'
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
vi.mock('../../src/api/principals')

const mockedApi = vi.mocked(api)
const mockedPreShipped = vi.mocked(preshippedApi)
const mockedTools = vi.mocked(toolsApi)
const mockedPrincipals = vi.mocked(principalsApi)

let pinia: Pinia
let router: Router

/** On a scoped `p/{principalId}/skill/{name}` path — the shape the app produces. */
async function mountOn(name: string, principalId = 7) {
    router = stubRoutes()
    await router.push(`/p/${principalId}/skill/${name}`)
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
    mockedPrincipals.listMyPrincipals.mockResolvedValue([makePrincipal()])

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
        expect(mockedApi.getSkill).not.toHaveBeenCalled()
    })

    it('reads a skill the store does not hold, for a deep link', async () => {
        useSkillsStore().skills = []
        const wrapper = await mountOn('expense-policy')
        await flushPromises()
        expect(mockedApi.getSkill).toHaveBeenCalledWith('expense-policy', 7)
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('invoice-drafting')
    })

    it('reads a group-owned skill against the principal its path names', async () => {

        useSkillsStore().skills = []
        mockedApi.getSkill.mockResolvedValue(makeSkill({ name: 'test', principal_id: 8 }))

        const wrapper = await mountOn('test', 8)
        await flushPromises()

        expect(mockedApi.getSkill).toHaveBeenCalledWith('test', 8)
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('test')
        expect(wrapper.find('[data-test="desk-missing"]').exists()).toBe(false)
    })

    it('does not issue the read while the principal list is still in flight', async () => {

        useSkillsStore().skills = []
        let release: (() => void) | null = null
        mockedPrincipals.listMyPrincipals.mockReturnValue(new Promise((resolve) => {
            release = () => resolve([
                makePrincipal(),
                makePrincipal({ id: 8, type: 'group', name: 'Ops', user_id: null, group_id: 2 }),
            ])
        }))

        await mountOn('test', 8)
        await flushPromises()
        expect(mockedApi.getSkill).not.toHaveBeenCalled()

        release!()
        await flushPromises()
        expect(mockedApi.getSkill).toHaveBeenCalledWith('test', 8)
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
        // A shipped skill has no row on any principal, so the custom read 404s for it.
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

        // The name is final, so a row for an unread body is a row to delete.
        expect(mockedApi.createSkill).not.toHaveBeenCalled()
        expect(router.currentRoute.value.path).toBe('/p/7/new')
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
        // The contents arrive in a second request, so this only reproduces through the page.
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
        // 413 over the 50 000-byte cap, or removed underneath: the rail is still right.
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

    it('updates the saved-declaration box on restore, so it cannot report a dropped declaration', async () => {
        // The box reads the restored row: `snapshotAttributes()` omits `allowed_tools`, so a restore
        // can drop a declaration.
        mockedApi.updateSkill.mockResolvedValue(
            makeSkill({ allowed_tools: 'agent read_url', updated_at: '2026-09-30 15:00:00' }),
        )
        mockedApi.restoreSkill.mockResolvedValue(makeSkill({ allowed_tools: null }))

        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Changed')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()
        expect(wrapper.get('[data-test="declared-tools-summary"]').text()).toContain('agent')

        await wrapper.get('[data-test="desk-restore"]').trigger('click')
        await flushPromises()
        expect(wrapper.get('[data-test="declared-tools-summary"]').text()).toContain('declares no tools')
    })
})

/** The post-save declaration box: what the skill declares and which names resolve here,
 *  never whether any agent has them — that is the host's per-agent Tools page. */
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
        // A live region, not a toast: a toast is gone before a declaration has been read.
        expect(box.element.tagName).toBe('OUTPUT')
        expect(box.get('[data-test="declared-tools-count"]').text()).toBe('2 tools')

        // A note on `agent` would be a false claim about this instance.
        const available = box.findAll('[data-test="declared-tool"]')
        expect(available).toHaveLength(1)
        expect(available[0]?.text()).toContain('agent')
        expect(available[0]?.text()).not.toContain('not available')
        expect(available[0]?.find('[data-test="declared-tool-unavailable-note"]').exists()).toBe(false)

        const unavailable = box.get('[data-test="declared-tool-unavailable"]')
        expect(unavailable.text()).toContain('legacy_erp_export')
        expect(unavailable.text()).toContain('not available on this instance')
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
        // A reader who just saved a declaration is exactly the person who will assume it is live.
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
        // No word may assert a tool is on, enabled or approved — the page has no agent to have checked.
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

        // An activation-gap link would be dead: the panel owns three routes, none an agent's tools.
        const box = wrapper.get('[data-test="declared-tools-summary"]')
        expect(box.findAll('a')).toHaveLength(0)
    })

    it('reports the server’s stored value rather than the draft, so it cannot describe an unsaved edit', async () => {
        // An author who unchecks a box and closes the tab has saved nothing.
        mockedApi.updateSkill.mockResolvedValue(
            makeSkill({ allowed_tools: 'agent', updated_at: '2026-09-30 15:00:00' }),
        )
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-test="tool-option-agent"] input').setValue(false)
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        await flushPromises()

        // The response still carries `agent`: a server that kept the value.
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
        // A failed read is "not read", not an empty instance, so no name reads as absent.
        mockedTools.listTools.mockRejectedValue(new Error('500'))
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()

        // `makeSkill()` declares `agent read_url`.
        expect(wrapper.findAll('[data-test^="tool-option-"]')).toHaveLength(2)
        expect(wrapper.get('[data-test="tool-option-read_url"] input').attributes('disabled')).toBeUndefined()
        expect(wrapper.find('[data-test="tool-unavailable-note"]').exists()).toBe(false)
    })

    it("carries a shipped skill's declaration onto the read-only desk", async () => {
        // `deskShape` has no `updated_at`, and the reload guard read the empty string as both "never
        // loaded" and "already loaded", so a shipped skill's first load was skipped.
        useSkillsStore().skills = []
        mockedApi.getSkill.mockRejectedValue(new Error('404 SKILL_NOT_FOUND'))
        mockedPreShipped.listPreShippedSkills.mockResolvedValue([makePreShipped()])
        mockedPreShipped.getPreShippedSkill.mockResolvedValue(
            makePreShippedDetail({ allowed_tools: 'typst_compile' }),
        )

        const wrapper = await mountOn('code-review')
        await flushPromises()


        expect(wrapper.find('[data-test="tool-option-typst_compile"]').exists()).toBe(true)
        expect(wrapper.get('[data-test="tool-option-typst_compile"] input').attributes('disabled')).toBeDefined()
    })

    it('loads a shipped skill’s frontmatter at all, which the empty timestamp used to suppress', async () => {
        // A shipped skill opened here used to render an empty body, so duplicating started from nothing.
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
    it('goes home on cancel, under the principal it was reading', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        await wrapper.get('[data-test="desk-cancel"]').trigger('click')
        await flushPromises()

        expect(router.currentRoute.value.path).toBe('/p/7')
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
        // The layout owns the dialog, so it owns the navigation: the desk must not read "deleted" off a
        // row that a principal change also makes disappear.
        expect(await store.confirmDelete()).toBe('invoice-drafting')
        await flushPromises()

        expect(store.skills).toHaveLength(0)
    })

    it('does not treat a list reload as a delete and bounce the operator off the desk', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        // A principal change replaces the whole list, so the open skill briefly leaves it; navigating away
        // here would lose a half-written body.
        useSkillsStore().skills = [makeSkill({ name: 'other', principal_id: 8 })]
        await flushPromises()
        expect(router.currentRoute.value.path).toBe('/p/7/skill/invoice-drafting')
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('invoice-drafting')
    })

    it('follows the operator to another skill without a reload', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        useSkillsStore().skills = [makeSkill({ name: 'expense-policy' })]
        await router.push('/p/7/skill/expense-policy')
        await flushPromises()
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('expense-policy')
    })

    it('re-resolves when only the principal in the path changes', async () => {
        const wrapper = await mountOn('invoice-drafting')
        await flushPromises()
        mockedApi.getSkill.mockResolvedValue(makeSkill({ name: 'invoice-drafting', principal_id: 8 }))
        useSkillsStore().skills = []

        await router.push('/p/8/skill/invoice-drafting')
        await flushPromises()

        expect(mockedApi.getSkill).toHaveBeenCalledWith('invoice-drafting', 8)
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('invoice-drafting')
    })

    it('never shows one principal\'s skill under another principal\'s URL', async () => {
        // `unique(principal_id, name)` permits one name under two principals, so a name-keyed lookup
        // returns principal 7's row and a save would overwrite principal 8's.
        useSkillsStore().skills = [makeSkill({ name: 'report', principal_id: 7, body: '# Seven' })]
        mockedApi.getSkill.mockResolvedValue(makeSkill({ name: 'report', principal_id: 8, body: '# Eight' }))

        const wrapper = await mountOn('report', 8)
        await flushPromises()

        expect(mockedApi.getSkill).toHaveBeenCalledWith('report', 8)
        const editor = wrapper.get('[data-testid="md-editor-stub"]').element as HTMLTextAreaElement
        expect(editor.value).toBe('# Eight')
        expect(editor.value).not.toBe('# Seven')
    })

    it('reads sidecars from the row on screen, not a name-keyed lookup', async () => {
        // A deep link the store never listed: the manifest used to come from `skillsByName`, which for
        useSkillsStore().skills = [makeSkill({ name: 'report', principal_id: 7 })]
        mockedApi.getSkill.mockResolvedValue(makeSkill({
            name: 'report',
            principal_id: 8,
            files: [
                { path: 'SKILL.md', bytes: 10 },
                { path: 'examples/eight.md', bytes: 10 },
            ],
        }))

        await mountOn('report', 8)
        await flushPromises()

        expect(mockedApi.getSkillFile).toHaveBeenCalledWith('report', 'examples/eight.md', 8)
        expect(mockedApi.getSkillFile).not.toHaveBeenCalledWith('report', expect.anything(), 7)
    })
})
