/**
 * `HomePage` — what this principal owns.
 *
 * The three things the prototype makes load-bearing and these pin: the heading
 * names the principal (on a page you scroll, the scope bar scrolls out of reach),
 * an empty principal is a prompt rather than an error state, and the sort control
 * actually reorders. The delete blast radius test is carried over from the old
 * suite: it asserts the allowlist is READ before `DELETE` is issued, in that
 * order, because deleting a skill is a silent multi-agent config change.
 *
 * The page is seeded through the store rather than through the API: the reads are
 * the layout's job (`App.vue → onMounted`), so a spec that mocked them here would
 * be testing the wiring twice.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import HomePage from '../../src/pages/HomePage.vue'
import * as api from '../../src/api/customSkills'
import { useSkillsStore } from '../../src/stores/skills'
import { usePrincipalsStore } from '../../src/stores/principals'
import { makeAllowlistEntry, makePrincipal, makePreShipped, makeSkill } from '../fixtures'
import type { CustomSkillResource, PreShippedSkillSummary } from '../../src/types'
import { mountPage } from '../mountPage'

vi.mock('../../src/api/customSkills')
vi.mock('../../src/api/agentAllowlist')
vi.mock('../../src/api/agents')

const mockedApi = vi.mocked(api)

let pinia: Pinia

function seed(skills: CustomSkillResource[] = [], preShipped: PreShippedSkillSummary[] = []): void {
    const store = useSkillsStore()
    store.skills = skills
    store.preShipped = preShipped
    store.agents = [{ id: 5, name: 'Invoicer' }, { id: 6, name: 'Researcher' }]
}

function selectGroup(): void {
    const principals = usePrincipalsStore()
    principals.principals = [makePrincipal({ id: 8, type: 'group', name: 'Studio', user_id: null, group_id: 2 })]
    principals.selectedPrincipalId = 8
}

beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    mockedApi.getSkillAllowlist.mockResolvedValue([])
    mockedApi.restoreSkill.mockResolvedValue(makeSkill({ has_previous: false, body: '# Old' }))
    mockedApi.deleteSkill.mockResolvedValue({
        deleted: true,
        name: 'invoice-drafting',
        scrubbed_agents: [],
    })

    const principals = usePrincipalsStore()
    principals.principals = [makePrincipal()]
    principals.selectedPrincipalId = 7
    seed()
})

describe('HomePage → the heading states the principal', () => {
    it('names the principal, not the panel', async () => {
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        expect(wrapper.get('[data-test="home-principal"]').text()).toBe('Maya Fischer')
        expect(wrapper.get('[data-test="home-scope-blurb"]').text())
            .toBe('Your personal skills. Only you can see and edit these.')
    })

    it('separates reading from writing for a group scope', async () => {
        selectGroup()
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        expect(wrapper.get('[data-test="home-scope-blurb"]').text()).toContain('owner or an admin')
    })

    it('says there is no principal to read, rather than naming nothing', async () => {
        const principals = usePrincipalsStore()
        principals.principals = []
        principals.selectedPrincipalId = null
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        expect(wrapper.get('[data-test="home-principal"]').text()).toBe('No principal selected')
        expect(wrapper.get('[data-test="home-scope-blurb"]').text()).toBe('No principal is selected.')
    })

    it('counts the skills it is showing', async () => {
        seed([makeSkill(), makeSkill({ name: 'expense-policy' })])
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        expect(wrapper.get('[data-test="home-count"]').text()).toBe('2 in Maya Fischer')
    })

    it('points at the catalogue with the number of skills there to read', async () => {
        seed([], [makePreShipped({ name: 'code-review' }), makePreShipped({ name: 'release-notes' })])
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        const link = wrapper.get('[data-test="home-catalogue-link"]')
        expect(link.attributes('href')).toBe('/library')
        expect(link.text()).toContain('2 skills to read and copy')
    })
})

describe('HomePage → the empty state', () => {
    it('leads with creation and points at the catalogue second', async () => {
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        const empty = wrapper.get('[data-test="home-empty"]')
        expect(empty.text()).toContain('No skills yet')
        expect(empty.text()).toContain('copy it from the catalogue')
        expect(empty.get('[data-test="home-empty-new"]').attributes('href')).toBe('/new')
        expect(empty.get('[data-test="home-empty-catalogue"]').attributes('href')).toBe('/library')
        // A prompt, not an error state: nothing here is red.
        expect(empty.classes().join(' ')).not.toContain('destructive')
    })

    it('says the group’s skills are shared, not private', async () => {
        selectGroup()
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        const empty = wrapper.get('[data-test="home-empty"]')
        expect(empty.text()).toContain('owner or an admin')
        expect(empty.text()).not.toContain('yours alone')
    })

    it('renders no list at all while the principal has nothing', async () => {
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        expect(wrapper.find('[data-test="skill-list"]').exists()).toBe(false)
    })

    it('does not clip the list, so a row menu is not cropped away', async () => {
        // A row's menu is absolutely positioned inside this list, so an
        // `overflow-hidden` here crops the panel to the list box and the menu is
        // simply not on screen. jsdom performs no layout, so the menu's own tests
        // pass either way — the clip is only observable as a class, which is what
        // this asserts.
        seed([makeSkill(), makeSkill({ name: 'research' })])
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        const classes = wrapper.get('[data-test="skill-list"]').classes().join(' ')
        expect(classes).not.toContain('overflow-hidden')
        // The corners the clip used to provide are now stated on the edge rows.
        expect(classes).toContain('[&>li:first-child]:rounded-t-xl')
        expect(classes).toContain('[&>li:last-child]:rounded-b-xl')
    })

    it('shows a loading line rather than the empty state mid-read', async () => {
        useSkillsStore().loading = true
        const wrapper = mountPage(HomePage, pinia)
        expect(wrapper.find('[data-test="home-empty"]').exists()).toBe(false)
    })
})

describe('HomePage → the sort control', () => {
    const unsorted = [
        makeSkill({ name: 'beta', updated_at: '2026-03-02 00:00:00', created_at: '2026-01-02 00:00:00' }),
        makeSkill({ name: 'alpha', updated_at: '2026-03-01 00:00:00', created_at: '2026-01-03 00:00:00' }),
    ]

    it('carries the id the panel’s other surfaces and the operator know it by', async () => {
        seed(unsorted)
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        const select = wrapper.get('#skill-sort')
        expect(select.findAll('option').map((o) => o.text())).toEqual([
            'Recently updated',
            'Recently created',
            'Name (A–Z)',
            'Name (Z–A)',
        ])
        expect((select.element as HTMLSelectElement).value).toBe('updated')
    })

    it('defaults to most recently updated', async () => {
        seed(unsorted)
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        expect(names(wrapper)).toEqual(['beta', 'alpha'])
    })

    it('reorders on selection', async () => {
        seed(unsorted)
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()

        await wrapper.get('#skill-sort').setValue('name-asc')
        expect(names(wrapper)).toEqual(['alpha', 'beta'])

        await wrapper.get('#skill-sort').setValue('name-desc')
        expect(names(wrapper)).toEqual(['beta', 'alpha'])

        await wrapper.get('#skill-sort').setValue('created')
        expect(names(wrapper)).toEqual(['alpha', 'beta'])
    })
})

describe('HomePage → delete names the blast radius before the write', () => {
    it('reads the allowlist, then DELETEs', async () => {
        seed([makeSkill()])
        const order: string[] = []
        mockedApi.getSkillAllowlist.mockImplementation(async () => {
            order.push('allowlist-read')
            return [makeAllowlistEntry({ id: 5, name: 'Invoicer' })]
        })
        mockedApi.deleteSkill.mockImplementation(async () => {
            order.push('delete')
            return { deleted: true, name: 'invoice-drafting', scrubbed_agents: [] }
        })

        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        await wrapper.get('[data-test="row-delete"]').trigger('click')
        await flushPromises()

        // The dialog lives in the layout, so the page's contribution is the read
        // that has to happen before anyone can confirm. The menu also read the
        // allowlist to render it, hence two reads and no write.
        expect(order.filter((step) => step === 'delete')).toEqual([])
        expect(order[0]).toBe('allowlist-read')
        expect(useSkillsStore().pendingDelete).toBe('invoice-drafting')
        expect(useSkillsStore().deleteBlastRadius).toEqual(['Invoicer'])
    })

    it('reports which agents were actually scrubbed after the write', async () => {
        seed([makeSkill()])
        mockedApi.getSkillAllowlist.mockResolvedValue([makeAllowlistEntry({ id: 5, name: 'Invoicer' })])
        mockedApi.deleteSkill.mockResolvedValue({
            deleted: true,
            name: 'invoice-drafting',
            scrubbed_agents: [{ id: 5, name: 'Invoicer' }],
        })

        const store = useSkillsStore()
        await store.requestDelete('invoice-drafting')
        await store.confirmDelete()
        expect(store.notice).toBe('Deleted invoice-drafting and removed it from 1 agent: Invoicer.')
    })
})

describe('HomePage → row actions', () => {
    it('restores a previous version and says so', async () => {
        seed([makeSkill()])
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        await wrapper.get('[data-test="row-restore"]').trigger('click')
        await flushPromises()
        expect(mockedApi.restoreSkill).toHaveBeenCalledWith('invoice-drafting', 7)
        expect(useSkillsStore().notice).toBe('Restored the previous version of invoice-drafting.')
    })

    it('enables the skill on the chosen agent', async () => {
        seed([makeSkill()])
        mockedApi.getSkillAllowlist.mockResolvedValue([])
        const wrapper = mountPage(HomePage, pinia)
        await flushPromises()
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        await wrapper.get('[data-test="agent-select"]').setValue('5')
        await wrapper.get('[data-test="enable-confirm"]').trigger('click')
        await flushPromises()
        expect(mockedApi.getSkillAllowlist).toHaveBeenCalledWith('invoice-drafting', 7)
    })
})

function names(wrapper: ReturnType<typeof mountPage>): string[] {
    return wrapper.findAll('[data-test="skill-name"]').map((n) => n.text())
}
