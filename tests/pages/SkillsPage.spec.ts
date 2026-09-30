/**
 * `SkillsPage` — the two panes, the empty states, the per-pane search,
 * and the delete blast radius.
 *
 * The blast-radius test is the one that matters most: it asserts the
 * allowlist is READ before `DELETE` is issued, in that order, so the
 * confirmation dialog names the affected agents. Deleting a skill is a
 * silent multi-agent config change otherwise.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import SkillsPage from '../../src/pages/SkillsPage.vue'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../../src/shims'
import { setApi } from '../../src/api/client'
import * as api from '../../src/api/customSkills'
import * as preshippedApi from '../../src/api/preshippedSkills'
import { usePrincipalsStore } from '../../src/stores/principals'
import { makeSkill, makePreShipped, makePreShippedDetail, makeAllowlistEntry } from '../fixtures'

vi.mock('../../src/api/customSkills')
vi.mock('../../src/api/preshippedSkills')

const mockedApi = vi.mocked(api)
const mockedPreshipped = vi.mocked(preshippedApi)

// The page's store must resolve the *same* Pinia the test seeded, or
// `selectedPrincipalId` reads back as `null` and every call goes out
// without `?principal_id=`.
let pinia: Pinia

function mountPage() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'skills', component: SkillsPage },
            { path: '/:name', name: 'skill', component: SkillsPage },
        ],
    })
    const hostContext: PluginHostContext = {
        api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
        pinia: null,
        theme: 'light',
        route: null,
        router: null,
    }
    return mount(SkillsPage, {
        global: {
            plugins: [pinia, router],
            provide: { [HOST_CONTEXT_KEY as symbol]: hostContext },
        },
    })
}

beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    setApi({
        get: vi.fn().mockResolvedValue({ agents: [{ id: 5, name: 'Invoicer' }, { id: 6, name: 'Researcher' }] }),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    } as never)
    mockedApi.listSkills.mockResolvedValue([])
    mockedApi.listSkillFiles.mockResolvedValue([])
    mockedApi.getSkillFile.mockResolvedValue({ path: 'examples/invoice.md', content: 'x', bytes: 1 })
    mockedApi.getSkillAllowlist.mockResolvedValue([])
    mockedPreshipped.listPreShippedSkills.mockResolvedValue([])

    const principals = usePrincipalsStore()
    principals.principals = [{ id: 7, type: 'user', name: 'User #7', user_id: 3, group_id: null }]
    principals.selectedPrincipalId = 7
})

describe('SkillsPage → empty states', () => {
    it('explains how to get a first skill instead of saying “No items”', async () => {
        const wrapper = mountPage()
        await flushPromises()
        const empty = wrapper.get('[data-test="mine-empty"]')
        expect(empty.text()).toContain('No custom skills on this principal yet')
        expect(empty.text()).toContain('Duplicate')
    })

    it('says the host ships no skills, and names the host route', async () => {
        const wrapper = mountPage()
        await flushPromises()
        const empty = wrapper.get('[data-test="preshipped-empty"]')
        expect(empty.text()).toContain('This host ships no skills')
        expect(empty.text()).toContain('/api/v1/skills')
    })

    it('distinguishes “nothing matches” from “nothing exists” in both panes', async () => {
        mockedApi.listSkills.mockResolvedValue([makeSkill()])
        mockedPreshipped.listPreShippedSkills.mockResolvedValue([makePreShipped()])
        const wrapper = mountPage()
        await flushPromises()

        await wrapper.get('[data-test="pane-search-my-skills"]').setValue('zzz')
        await wrapper.get('[data-test="pane-search-pre-shipped"]').setValue('zzz')
        await flushPromises()

        const mine = wrapper.get('[data-test="mine-search-empty"]')
        expect(mine.text()).toContain('No skill matches “zzz”')
        // The real count is quoted so the operator can tell a bad filter
        // from an empty principal.
        expect(mine.text()).toContain('all 1 on this principal')
        expect(wrapper.get('[data-test="preshipped-search-empty"]').text()).toContain('No pre-shipped skill matches “zzz”')
    })
})

describe('SkillsPage → per-pane search', () => {
    beforeEach(() => {
        mockedApi.listSkills.mockResolvedValue([
            makeSkill({ name: 'invoice-drafting', description: 'Draft an invoice.' }),
            makeSkill({ name: 'expense-policy', description: 'Reimburse a claim.' }),
        ])
        mockedPreshipped.listPreShippedSkills.mockResolvedValue([
            makePreShipped({ name: 'code-review', source: 'core' }),
            makePreShipped({ name: 'brand-voice', source: 'marketing' }),
        ])
    })

    it('filters the My skills pane by name', async () => {
        const wrapper = mountPage()
        await flushPromises()
        expect(wrapper.findAll('[data-test="skill-card"]')).toHaveLength(2)
        await wrapper.get('[data-test="pane-search-my-skills"]').setValue('invoice')
        await flushPromises()
        const names = wrapper.findAll('[data-test="skill-name"]').map((n) => n.text())
        expect(names).toEqual(['invoice-drafting'])
    })

    it('matches on description as well as name', async () => {
        const wrapper = mountPage()
        await flushPromises()
        await wrapper.get('[data-test="pane-search-my-skills"]').setValue('reimburse')
        await flushPromises()
        expect(wrapper.findAll('[data-test="skill-name"]').map((n) => n.text())).toEqual(['expense-policy'])
    })

    it('the two search terms are independent', async () => {
        const wrapper = mountPage()
        await flushPromises()
        await wrapper.get('[data-test="pane-search-my-skills"]').setValue('invoice')
        await wrapper.get('[data-test="pane-search-pre-shipped"]').setValue('brand')
        await flushPromises()
        // Typing in one pane must not narrow the other.
        expect(wrapper.findAll('[data-test="skill-name"]')).toHaveLength(1)
        expect(wrapper.findAll('[data-test="preshipped-name"]').map((n) => n.text())).toEqual(['brand-voice'])
    })

    it('the clear button resets the filter', async () => {
        const wrapper = mountPage()
        await flushPromises()
        await wrapper.get('[data-test="pane-search-my-skills"]').setValue('invoice')
        await flushPromises()
        await wrapper.get('[data-test="pane-search-clear"]').trigger('click')
        await flushPromises()
        expect(wrapper.findAll('[data-test="skill-card"]')).toHaveLength(2)
    })
})

describe('SkillsPage → pre-shipped grouping', () => {
    it('groups the catalogue by source', async () => {
        mockedPreshipped.listPreShippedSkills.mockResolvedValue([
            makePreShipped({ name: 'code-review', source: 'core' }),
            makePreShipped({ name: 'release-notes', source: 'core' }),
            makePreShipped({ name: 'brand-voice', source: 'marketing' }),
        ])
        const wrapper = mountPage()
        await flushPromises()
        const groups = wrapper.findAll('[data-test="source-group"]').map((g) => g.text())
        expect(groups).toEqual(['core · 2', 'marketing · 1'])
    })

    it('groups after filtering, not before', async () => {
        mockedPreshipped.listPreShippedSkills.mockResolvedValue([
            makePreShipped({ name: 'code-review', source: 'core' }),
            makePreShipped({ name: 'brand-voice', source: 'marketing' }),
        ])
        const wrapper = mountPage()
        await flushPromises()
        await wrapper.get('[data-test="pane-search-pre-shipped"]').setValue('brand')
        await flushPromises()
        expect(wrapper.findAll('[data-test="source-group"]').map((g) => g.text())).toEqual(['marketing · 1'])
    })
})

describe('SkillsPage → allowlist affordance', () => {
    it('states the agent-side failure verbatim when nothing allowlists the skill', async () => {
        mockedApi.listSkills.mockResolvedValue([makeSkill()])
        const wrapper = mountPage()
        await flushPromises()
        expect(wrapper.get('[data-test="allowlist-empty"]').text()).toBe(
            'Not enabled for any agent yet — add it to an agent\'s Skill tool settings before the agent can use it.',
        )
    })

    it('names the agents that do allowlist it, with their scope', async () => {
        mockedApi.listSkills.mockResolvedValue([makeSkill()])
        mockedApi.getSkillAllowlist.mockResolvedValue([
            makeAllowlistEntry({ id: 5, name: 'Invoicer', scope: 'agent' }),
            makeAllowlistEntry({ id: 6, name: 'Researcher', scope: 'principal' }),
        ])
        const wrapper = mountPage()
        await flushPromises()
        // Opening the picker is what triggers the allowlist read.
        await wrapper.get('[data-test="toggle-agent-picker"]').trigger('click')
        await flushPromises()
        const list = wrapper.findAll('[data-test="allowlist-list"] li')
        expect(list[0]?.text()).toContain('Invoicer')
        // A principal-scope entry means the agent inherits the default,
        // not that it carries its own entry — the label has to say which.
        expect(list[0]?.text()).toContain('agent override')
        expect(list[1]?.text()).toContain('Researcher')
        expect(list[1]?.text()).toContain('inherited default')
    })

    it('offers only agents that do not already resolve the skill', async () => {
        mockedApi.listSkills.mockResolvedValue([makeSkill()])
        mockedApi.getSkillAllowlist.mockResolvedValue([makeAllowlistEntry({ id: 5, name: 'Invoicer', scope: 'agent' })])
        const wrapper = mountPage()
        await flushPromises()
        await wrapper.get('[data-test="toggle-agent-picker"]').trigger('click')
        await flushPromises()
        const options = wrapper.findAll('[data-test="agent-select"] option').map((o) => o.text())
        expect(options).toContain('Researcher')
        expect(options).not.toContain('Invoicer')
    })
})

describe('SkillsPage → delete names the blast radius before the write', () => {
    it('reads the allowlist, shows the agent names, and only then DELETEs', async () => {
        mockedApi.listSkills.mockResolvedValue([makeSkill()])
        mockedApi.getSkillAllowlist.mockResolvedValue([
            makeAllowlistEntry({ id: 5, name: 'Invoicer', scope: 'agent' }),
            makeAllowlistEntry({ id: 6, name: 'Researcher', scope: 'principal' }),
        ])
        mockedApi.deleteSkill.mockResolvedValue({
            deleted: true,
            name: 'invoice-drafting',
            scrubbed_agents: [{ id: 5, name: 'Invoicer' }, { id: 6, name: 'Researcher' }],
        })

        const order: string[] = []
        mockedApi.getSkillAllowlist.mockImplementation(async () => {
            order.push('allowlist-read')
            return [makeAllowlistEntry({ id: 5, name: 'Invoicer', scope: 'agent' })]
        })
        mockedApi.deleteSkill.mockImplementation(async () => {
            order.push('delete')
            return { deleted: true, name: 'invoice-drafting', scrubbed_agents: [] }
        })

        const wrapper = mountPage()
        await flushPromises()
        await wrapper.get('[data-test="delete-skill"]').trigger('click')
        await flushPromises()

        // Nothing was written to open the dialog.
        expect(mockedApi.deleteSkill).not.toHaveBeenCalled()

        const dialog = wrapper.get('[data-test="confirm-dialog"]')
        expect(dialog.get('[data-test="confirm-body"]').text()).toContain('invoice-drafting')
        const blast = dialog.get('[data-test="confirm-blast-radius"]')
        expect(blast.text()).toContain('Invoicer')
        expect(blast.text()).toContain('Enable on agent…')

        await dialog.get('[data-test="confirm-accept"]').trigger('click')
        await flushPromises()

        expect(order).toEqual(['allowlist-read', 'delete'])
    })

    it('says nothing is affected when the skill is on no allowlist', async () => {
        mockedApi.listSkills.mockResolvedValue([makeSkill()])
        mockedApi.getSkillAllowlist.mockResolvedValue([])
        const wrapper = mountPage()
        await flushPromises()
        await wrapper.get('[data-test="delete-skill"]').trigger('click')
        await flushPromises()
        const dialog = wrapper.get('[data-test="confirm-dialog"]')
        expect(dialog.find('[data-test="confirm-blast-radius"]').exists()).toBe(false)
        expect(dialog.text()).toContain('No agent currently has this skill on its allowlist.')
    })

    it('cancelling the dialog issues no write', async () => {
        mockedApi.listSkills.mockResolvedValue([makeSkill()])
        const wrapper = mountPage()
        await flushPromises()
        await wrapper.get('[data-test="delete-skill"]').trigger('click')
        await flushPromises()
        await wrapper.get('[data-test="confirm-cancel"]').trigger('click')
        await flushPromises()
        expect(mockedApi.deleteSkill).not.toHaveBeenCalled()
        expect(wrapper.find('[data-test="confirm-dialog"]').exists()).toBe(false)
    })

    it('reports which agents were actually scrubbed after the write', async () => {
        mockedApi.listSkills.mockResolvedValue([makeSkill()])
        mockedApi.getSkillAllowlist.mockResolvedValue([makeAllowlistEntry({ id: 5, name: 'Invoicer', scope: 'agent' })])
        mockedApi.deleteSkill.mockResolvedValue({
            deleted: true,
            name: 'invoice-drafting',
            scrubbed_agents: [{ id: 5, name: 'Invoicer' }],
        })
        const wrapper = mountPage()
        await flushPromises()
        await wrapper.get('[data-test="delete-skill"]').trigger('click')
        await flushPromises()
        await wrapper.get('[data-test="confirm-accept"]').trigger('click')
        await flushPromises()
        expect(wrapper.text()).toContain('removed it from 1 agent: Invoicer')
    })
})

describe('SkillsPage → fork from pre-shipped', () => {
    it('duplicates a shipped skill onto the principal under a non-reserved name', async () => {
        mockedApi.listSkills.mockResolvedValue([])
        mockedPreshipped.listPreShippedSkills.mockResolvedValue([makePreShipped({ name: 'code-review' })])
        mockedPreshipped.getPreShippedSkill.mockResolvedValue(makePreShippedDetail({ name: 'code-review' }))
        mockedApi.createSkill.mockResolvedValue(makeSkill({ name: 'code-review-copy' }))

        const wrapper = mountPage()
        await flushPromises()
        await wrapper.get('[data-test="duplicate-skill"]').trigger('click')
        await flushPromises()

        expect(mockedPreshipped.getPreShippedSkill).toHaveBeenCalledWith('code-review')
        expect(mockedApi.createSkill).toHaveBeenCalledWith(7, expect.objectContaining({
            name: 'code-review-copy',
            body: '# Review\n',
            license: 'MIT',
        }))
    })

    it('warns that shipped sidecar contents are not readable through the host API', async () => {
        mockedPreshipped.listPreShippedSkills.mockResolvedValue([makePreShipped({ name: 'code-review' })])
        mockedPreshipped.getPreShippedSkill.mockResolvedValue(
            makePreShippedDetail({
                files: [
                    { path: 'SKILL.md', bytes: 10 },
                    { path: 'references/REFERENCE.md', bytes: 20 },
                ],
            }),
        )
        mockedApi.createSkill.mockResolvedValue(makeSkill({ name: 'code-review-copy' }))
        const wrapper = mountPage()
        await flushPromises()
        await wrapper.get('[data-test="duplicate-skill"]').trigger('click')
        await flushPromises()
        expect(wrapper.text()).toContain('re-add 1 sidecar file (references/REFERENCE.md)')
    })
})
