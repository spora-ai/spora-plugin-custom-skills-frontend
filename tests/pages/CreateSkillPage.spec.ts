/**
 * `CreateSkillPage` — `/new`.
 *
 * The form's whole job is to make two immutable facts visible before anything is
 * written: the name is fixed at creation (the contract rejects a rename with 422),
 * and a new skill always has a `SKILL.md` (the reserved path is synthesised
 * server-side, so seeding it costs nothing on the wire).
 *
 * So the create button is disabled until the name is *valid* — not merely
 * non-empty — and the seeded outline is asserted on the wire, not just in the
 * markup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import CreateSkillPage from '../../src/pages/CreateSkillPage.vue'
import * as api from '../../src/api/customSkills'
import { useSkillsStore } from '../../src/stores/skills'
import { usePrincipalsStore } from '../../src/stores/principals'
import { makePrincipal, makePreShipped, makeSkill, makeValidationEntry } from '../fixtures'
import { mountPage, stubRoutes } from '../mountPage'

vi.mock('../../src/api/customSkills')

const mockedApi = vi.mocked(api)

let pinia: Pinia

/** A form the operator could submit: a valid name and a description. */
async function fill(wrapper: ReturnType<typeof mountPage>): Promise<void> {
    await wrapper.get('[data-test="field-name"]').setValue('invoice-drafting')
    await wrapper.get('[data-test="field-description"]').setValue('How to draft an invoice.')
}

beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    mockedApi.createSkill.mockResolvedValue(makeSkill({ name: 'invoice-drafting' }))

    const principals = usePrincipalsStore()
    principals.principals = [makePrincipal()]
    principals.selectedPrincipalId = 7
    const store = useSkillsStore()
    store.skills = []
    store.preShipped = []
})

describe('CreateSkillPage → the name is required, and final', () => {
    it('cannot submit without a name', async () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        expect(wrapper.get('[data-test="create-submit"]').attributes('disabled')).toBeDefined()

        await wrapper.get('[data-test="field-description"]').setValue('How to draft an invoice.')
        // A description alone is not enough: the name is the identifier.
        expect(wrapper.get('[data-test="create-submit"]').attributes('disabled')).toBeDefined()
    })

    it('cannot submit with a name the server would reject', async () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        await fill(wrapper)
        expect(wrapper.get('[data-test="create-submit"]').attributes('disabled')).toBeUndefined()

        await wrapper.get('[data-test="field-name"]').setValue('Invoice Drafting')
        expect(wrapper.get('[data-test="create-submit"]').attributes('disabled')).toBeDefined()
    })

    it('cannot submit without a description, which is what an agent matches on', async () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        await wrapper.get('[data-test="field-name"]').setValue('invoice-drafting')
        expect(wrapper.get('[data-test="create-submit"]').attributes('disabled')).toBeDefined()
    })

    it('shows the validity as it is typed, not after a rejected submit', async () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        expect(wrapper.find('[data-test="name-valid"]').exists()).toBe(false)

        await wrapper.get('[data-test="field-name"]').setValue('invoice--drafting')
        expect(wrapper.find('[data-test="name-invalid"]').exists()).toBe(true)
        expect(wrapper.get('[data-test="name-error"]').text()).toContain('single hyphens')

        await wrapper.get('[data-test="field-name"]').setValue('invoice-drafting')
        expect(wrapper.find('[data-test="name-valid"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="name-error"]').exists()).toBe(false)
    })

    it('names the 409 a taken name would earn, before the POST', async () => {
        useSkillsStore().skills = [makeSkill({ name: 'invoice-drafting' })]
        const wrapper = mountPage(CreateSkillPage, pinia)
        await fill(wrapper)
        expect(wrapper.get('[data-test="name-error"]').text()).toContain('already exists on this principal')
        expect(wrapper.get('[data-test="create-submit"]').attributes('disabled')).toBeDefined()
    })

    it('names the 409 a shipped name would earn, before the POST', async () => {
        useSkillsStore().preShipped = [makePreShipped({ name: 'invoice-drafting' })]
        const wrapper = mountPage(CreateSkillPage, pinia)
        await fill(wrapper)
        expect(wrapper.get('[data-test="name-error"]').text()).toContain('shipped skill')
        expect(wrapper.get('[data-test="create-submit"]').attributes('disabled')).toBeDefined()
    })

    it('states the lock, because "you cannot change this" is only trusted at the moment of creation', () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        expect(wrapper.text()).toContain('cannot be changed')
    })

    it('blocks submit at the 25-skill cap rather than letting the POST 422', async () => {
        useSkillsStore().skills = Array.from({ length: 25 }, (_, i) => makeSkill({ name: `skill-${i}` }))
        const wrapper = mountPage(CreateSkillPage, pinia)
        await fill(wrapper)
        expect(wrapper.text()).toContain('25 skills')
        expect(wrapper.get('[data-test="create-submit"]').attributes('disabled')).toBeDefined()
    })
})

describe('CreateSkillPage → what the create sends', () => {
    it('POSTs the name, the description and a seeded SKILL.md outline', async () => {
        const router = stubRoutes()
        const wrapper = mountPage(CreateSkillPage, pinia, router)
        await fill(wrapper)
        await wrapper.get('[data-test="create-form"]').trigger('submit')
        await flushPromises()

        expect(mockedApi.createSkill).toHaveBeenCalledWith(7, {
            name: 'invoice-drafting',
            description: 'How to draft an invoice.',
            body: expect.stringContaining('# Invoice drafting'),
            license: null,
            compatibility: null,
            allowed_tools: null,
            metadata: {},
            files: {},
        })
        const sent = mockedApi.createSkill.mock.calls[0]?.[1] as { body: string }
        expect(sent.body).toContain('## When to use this')
        expect(sent.body).toContain('## Instructions')
        expect(sent.body).toContain('## Never')
    })

    it('lands on the desk, where SKILL.md is already open', async () => {
        const router = stubRoutes()
        const wrapper = mountPage(CreateSkillPage, pinia, router)
        await fill(wrapper)
        await wrapper.get('[data-test="create-form"]').trigger('submit')
        await flushPromises()
        expect(router.currentRoute.value.path).toBe('/skills/invoice-drafting')
    })

    it('trims the name and the description', async () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        await wrapper.get('[data-test="field-name"]').setValue('  invoice-drafting  ')
        await wrapper.get('[data-test="field-description"]').setValue('  How to draft one.  ')
        await wrapper.get('[data-test="create-form"]').trigger('submit')
        await flushPromises()
        expect(mockedApi.createSkill).toHaveBeenCalledWith(7, expect.objectContaining({
            name: 'invoice-drafting',
            description: 'How to draft one.',
        }))
    })

    it('does not POST while the button is disabled', async () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        await wrapper.get('[data-test="create-form"]').trigger('submit')
        await flushPromises()
        expect(mockedApi.createSkill).not.toHaveBeenCalled()
    })
})

describe('CreateSkillPage → a rejection keeps the form and its input', () => {
    /** The specs that assert a route have to stand on it first: the router starts at `/`. */
    async function mountOnCreateRoute(): Promise<ReturnType<typeof mountPage>> {
        const router = stubRoutes()
        await router.push('/new')
        await router.isReady()
        return mountPage(CreateSkillPage, pinia, router)
    }

    it('renders the validator’s name error under the field', async () => {
        mockedApi.createSkill.mockRejectedValue(
            Object.assign(new Error('Skill is invalid.'), {
                data: { errors: [makeValidationEntry({ code: 'NAME_PATTERN', message: 'no double hyphens', path: 'name' })] },
            }),
        )
        const wrapper = mountPage(CreateSkillPage, pinia)
        await fill(wrapper)
        await wrapper.get('[data-test="create-form"]').trigger('submit')
        await flushPromises()

        const errors = wrapper.findAll('[data-test="field-error"]')
        expect(errors).toHaveLength(1)
        expect(errors[0]?.text()).toContain('no double hyphens')
        expect((wrapper.get('[data-test="field-name"]').element as HTMLInputElement).value)
            .toBe('invoice-drafting')
    })

    it('renders a description error under the description field', async () => {
        mockedApi.createSkill.mockRejectedValue(
            Object.assign(new Error('Skill is invalid.'), {
                data: {
                    errors: [makeValidationEntry({
                        code: 'DESCRIPTION_TOO_LONG',
                        message: 'over 1024 chars',
                        path: 'description',
                    })],
                },
            }),
        )
        const wrapper = mountPage(CreateSkillPage, pinia)
        await fill(wrapper)
        await wrapper.get('[data-test="create-form"]').trigger('submit')
        await flushPromises()
        expect(wrapper.get('[data-test="field-description"]').attributes('aria-invalid')).toBe('true')
    })

    it('stays on /new so a rejected create does not look like a lost skill', async () => {
        mockedApi.createSkill.mockRejectedValue(new Error('boom'))
        const wrapper = await mountOnCreateRoute()
        await fill(wrapper)
        await wrapper.get('[data-test="create-form"]').trigger('submit')
        await flushPromises()
        expect(wrapper.vm.$router.currentRoute.value.path).toBe('/new')
        expect(useSkillsStore().error).toBe('Failed to create skill.')
    })
})

describe('CreateSkillPage → the page around the form', () => {
    it('names the principal the skill will belong to', () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        expect(wrapper.text()).toContain('In Maya Fischer')
        expect(wrapper.text()).toContain('Only you can see and edit these')
    })

    it('warns a group that writing needs to be an owner or an admin', () => {
        const principals = usePrincipalsStore()
        principals.principals = [makePrincipal({ id: 8, type: 'group', name: 'Studio', user_id: null, group_id: 2 })]
        principals.selectedPrincipalId = 8
        const wrapper = mountPage(CreateSkillPage, pinia)
        expect(wrapper.text()).toContain('owner or an admin')
    })

    it('offers a blank SKILL.md as the default and a route into the catalogue', () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        const blank = wrapper.get('[data-test="start-blank"]')
        expect((blank.element as HTMLInputElement).checked).toBe(true)
        expect(wrapper.get('[data-test="start-shipped"]').attributes('href')).toBe('/library')
    })

    it('goes back to home from the back link and from Cancel', async () => {
        const router = stubRoutes()
        const wrapper = mountPage(CreateSkillPage, pinia, router)
        expect(wrapper.get('[data-test="create-back"]').attributes('href')).toBe('/')
        expect(wrapper.get('[data-test="create-cancel"]').attributes('href')).toBe('/')
    })
})
