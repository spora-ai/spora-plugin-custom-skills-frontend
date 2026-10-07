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
import * as preshippedApi from '../../src/api/preshippedSkills'
import { useSkillsStore } from '../../src/stores/skills'
import { usePrincipalsStore } from '../../src/stores/principals'
import { makePrincipal, makePreShipped, makePreShippedDetail, makeSkill, makeValidationEntry } from '../fixtures'
import { mountPage, stubRoutes } from '../mountPage'

vi.mock('../../src/api/customSkills')
vi.mock('../../src/api/preshippedSkills')

const mockedApi = vi.mocked(api)
const mockedPreshipped = vi.mocked(preshippedApi)

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

describe('CreateSkillPage → the description field', () => {
    it('is a textarea, because the contract allows 1024 characters', () => {
        // As a single-line input a two-sentence description scrolled off the right
        // edge with nothing to show that it had.
        const field = mountPage(CreateSkillPage, pinia).get('[data-test="field-description"]')
        expect(field.element.tagName).toBe('TEXTAREA')
        expect(field.attributes('maxlength')).toBe('1024')
        expect(field.attributes('rows')).toBe('3')
    })

    it('counts what has been written, so 1024 is a ceiling you can see coming', async () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        await wrapper.get('[data-test="field-description"]').setValue('Drafts an invoice.')
        expect(wrapper.text()).toContain('18/1024')
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
            // Always sent, and `null` with no template: the shipped bundle sends the
            // key on every write, and absent-means-leave-alone would be a different
            // reading from the explicit null that revokes.
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
        expect(router.currentRoute.value.path).toBe('/p/7/skill/invoice-drafting')
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

    it('defaults to the starter outline and offers a route into the catalogue', () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        const starter = wrapper.get('[data-test="start-blank"]')
        expect((starter.element as HTMLInputElement).checked).toBe(true)
        expect(wrapper.text()).toContain('A short starter outline.')
        expect(wrapper.get('[data-test="start-shipped"]').attributes('href')).toBe('/p/7/library')
    })

    it('goes back to home from the back link and from Cancel', async () => {
        const router = stubRoutes()
        const wrapper = mountPage(CreateSkillPage, pinia, router)
        expect(wrapper.get('[data-test="create-back"]').attributes('href')).toBe('/p/7')
        expect(wrapper.get('[data-test="create-cancel"]').attributes('href')).toBe('/p/7')
    })
})

describe('CreateSkillPage → starting from a shipped skill', () => {
    /** A detail the host would serve for `?template=`, sidecars listed but unreadable. */
    function shippedDetail() {
        return makePreShippedDetail({
            name: 'code-review',
            description: 'Reviews a diff for defects.',
            license: 'MIT',
            metadata: { tier: 'core' },
            body: '# Review\n\n1. Read the diff.\n',
            files: [
                { path: 'SKILL.md', bytes: 10 },
                { path: 'references/REFERENCE.md', bytes: 20 },
            ],
        })
    }

    async function mountWithTemplate(name: string) {
        const router = stubRoutes()
        await router.push({ path: '/new', query: { template: name } })
        await router.isReady()
        return mountPage(CreateSkillPage, pinia, router)
    }

    it('prefills the name, the description and the body from the template', async () => {
        mockedPreshipped.getPreShippedSkill.mockResolvedValueOnce(shippedDetail())
        const wrapper = await mountWithTemplate('code-review')
        await flushPromises()

        expect(mockedPreshipped.getPreShippedSkill).toHaveBeenCalledWith('code-review')
        // The shipped name is reserved — a skill cannot be renamed afterwards — so
        // the suggestion has to be a free one.
        expect((wrapper.get('[data-test="field-name"]').element as HTMLInputElement).value)
            .toBe('code-review-copy')
        expect((wrapper.get('[data-test="field-description"]').element as HTMLInputElement).value)
            .toBe('Reviews a diff for defects.')
        expect(wrapper.get('[data-test="start-template"]').text()).toContain('code-review')
    })

    it('writes the shipped frontmatter and body, and names the sidecars it drops', async () => {
        mockedPreshipped.getPreShippedSkill.mockResolvedValueOnce(shippedDetail())
        mockedApi.createSkill.mockResolvedValueOnce(makeSkill({ name: 'code-review-copy' }))
        const wrapper = await mountWithTemplate('code-review')
        await flushPromises()

        // Said before the create, not only in a notice after it.
        expect(wrapper.text()).toContain('references/REFERENCE.md')

        // A `submit` on the form, not a click on the button: happy-dom does not
        // translate one into the other, and the handler is the form's.
        await wrapper.get('[data-test="create-form"]').trigger('submit')
        await flushPromises()

        expect(mockedApi.createSkill).toHaveBeenCalledWith(7, expect.objectContaining({
            name: 'code-review-copy',
            description: 'Reviews a diff for defects.',
            body: '# Review\n\n1. Read the diff.\n',
            license: 'MIT',
            metadata: { tier: 'core' },
            // Carried from the template, so a copy declares what the original
            // declares rather than arriving silent about it.
            allowed_tools: 'typst_compile',
            // Empty on purpose: the host serves no per-file read for a shipped
            // skill, and a blank file the operator did not write is worse than an
            // absent one they have been told about.
            files: {},
        }))
        expect(useSkillsStore().notice).toContain('re-add 1 sidecar file (references/REFERENCE.md)')
    })

    it('skips a fork name that this principal already has', async () => {
        useSkillsStore().skills = [makeSkill({ name: 'code-review-copy' })]
        mockedPreshipped.getPreShippedSkill.mockResolvedValueOnce(shippedDetail())
        const wrapper = await mountWithTemplate('code-review')
        await flushPromises()

        expect((wrapper.get('[data-test="field-name"]').element as HTMLInputElement).value)
            .toBe('code-review-copy-2')
    })

    it('does not overwrite a name the operator already typed', async () => {
        mockedPreshipped.getPreShippedSkill.mockResolvedValueOnce(shippedDetail())
        const router = stubRoutes()
        await router.push({ path: '/new' })
        await router.isReady()
        const wrapper = mountPage(CreateSkillPage, pinia, router)
        await wrapper.get('[data-test="field-name"]').setValue('my-own-name')

        // Arriving at `?template=` after typing must not throw that name away.
        await router.push({ path: '/new', query: { template: 'code-review' } })
        await flushPromises()

        expect((wrapper.get('[data-test="field-name"]').element as HTMLInputElement).value)
            .toBe('my-own-name')
    })

    it('says so when the named skill does not exist, rather than starting blank', async () => {
        mockedPreshipped.getPreShippedSkill.mockRejectedValueOnce(new Error('404'))
        const wrapper = await mountWithTemplate('nope')
        await flushPromises()

        expect(wrapper.text()).toContain('The host has no skill named')
        // Still a create form, not a dead end.
        expect(wrapper.find('[data-test="create-form"]').exists()).toBe(true)
    })

    it('starts blank with no template, and links to the catalogue to pick one', async () => {
        const wrapper = mountPage(CreateSkillPage, pinia)
        await flushPromises()

        expect((wrapper.get('[data-test="field-name"]').element as HTMLInputElement).value).toBe('')
        expect(wrapper.find('[data-test="start-template"]').exists()).toBe(false)
        expect(wrapper.get('[data-test="start-shipped"]').attributes('href')).toBe('/p/7/library')
    })
})
