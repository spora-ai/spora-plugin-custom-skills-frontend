/**
 * The German catalogue, rendered.
 *
 * `en.json` is an identity map, so the English assertions elsewhere in the suite cannot tell a
 * translated component from an untranslated one. This spec mounts the surfaces with a `de`
 * instance and reads what an operator would actually see — the catalogue, the wiring and the
 * component template are three separate things, and only the rendered output proves all three
 * line up.
 *
 * It also pins the other half of the rule: text the *operator* wrote — a skill description, a
 * tool's own display name — is not the panel's copy and must survive a German locale untouched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { config, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import SkillRow from '../src/components/SkillRow.vue'
import SkillDesk from '../src/components/SkillDesk.vue'
import DeclaredToolsField from '../src/components/DeclaredToolsField.vue'
import FileDialog from '../src/components/FileDialog.vue'
import ConfirmDialog from '../src/components/ConfirmDialog.vue'
import PrincipalScopeBar from '../src/components/PrincipalScopeBar.vue'
import SkillSortSelect from '../src/components/SkillSortSelect.vue'
import HomePage from '../src/pages/HomePage.vue'
import CreateSkillPage from '../src/pages/CreateSkillPage.vue'
import CataloguePage from '../src/pages/CataloguePage.vue'
import { createPluginI18n } from '../src/i18n'
import { updatedLabel } from '../src/lib/skillFormat'
import { usePrincipalsStore } from '../src/stores/principals'
import { useSkillsStore } from '../src/stores/skills'
import { makePrincipal, makeSkill, makeTool, makeTools } from './fixtures'
import { mountPage, stubRoutes } from './mountPage'

// The suite-wide setup installs an `en` instance for every mount. This file is about the German
// one, so it *replaces* that instance rather than adding a second: two i18n instances in one app
// register the same global components twice, and Vue warns about it.
config.global.plugins = [createPluginI18n('de')]

let pinia: Pinia

beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()

    const principals = usePrincipalsStore()
    principals.principals = [makePrincipal()]
    principals.selectedPrincipalId = 7

    const store = useSkillsStore()
    store.skills = [makeSkill()]
    store.preShipped = []
    store.agents = [{ id: 5, name: 'Invoicer' }]
})

describe('German catalogue → the panel renders German', () => {
    it('renders the scope bar in German', () => {
        const wrapper = mount(PrincipalScopeBar, { global: { plugins: [pinia, stubRoutes()] } })

        const text = wrapper.text()
        expect(text).toContain('Skill-Übersicht')
        expect(text).toContain('Katalog')
        expect(text).toContain('Neuer Skill')
    })

    it('renders the home page in German', () => {
        const wrapper = mountPage(HomePage, pinia)

        const text = wrapper.text()
        expect(text).toContain('Ihre persönlichen Skills')
        expect(text).toContain('Alle Skills')
        expect(text).toContain('Mit einem mitgelieferten Skill beginnen')
        expect(text).toContain('Skills zum Lesen und Kopieren')
    })

    it('renders the create form in German', () => {
        const wrapper = mountPage(CreateSkillPage, pinia)

        const text = wrapper.text()
        expect(text).toContain('Neuer Skill')
        expect(text).toContain('Skill-Name')
        expect(text).toContain('Beschreibung')
        expect(text).toContain('Starten mit')
        expect(text).toContain('Erstellen und mit dem Schreiben beginnen')
        expect(text).toContain('Abbrechen')
    })

    it('renders the catalogue in German', () => {
        const wrapper = mountPage(CataloguePage, pinia)

        const text = wrapper.text()
        expect(text).toContain('Katalog')
        expect(text).toContain('Dieser Host bringt keine Skills mit')
        expect(text).toContain('Sortieren')
    })

    it('renders the desk in German', () => {
        const wrapper = mount(SkillDesk, {
            props: { skill: makeSkill(), tools: makeTools() },
        })

        const text = wrapper.text()
        expect(text).toContain('Skill speichern')
        expect(text).toContain('Jeder Skill hat eine')
        expect(text).toContain('Werkzeuge, die dieser Skill verwendet')
        expect(text).toContain('Metadaten')
    })

    it('renders the declared-tools block in German', () => {
        const wrapper = mount(DeclaredToolsField, {
            props: { modelValue: 'agent', tools: makeTools() },
        })

        expect(wrapper.text()).toContain('Werkzeuge, die dieser Skill verwendet')
        expect(wrapper.text()).toContain('Ein Hinweis für alle, die diesen Skill lesen.')
    })

    it('renders the file dialog in German', () => {
        const wrapper = mount(FileDialog, {
            props: { open: true, mode: 'create', initialName: '', initialFolder: '', folders: [], takenPaths: [] },
        })

        const text = wrapper.text()
        expect(text).toContain('Ein Skill ist ein Ordner:')
        expect(text).toContain('Ordner')
        expect(text).toContain('Dateiname')
        expect(text).toContain('Abbrechen')
    })

    it('renders the delete confirmation in German', () => {
        const wrapper = mount(ConfirmDialog, {
            props: { open: true, title: 'Diesen Skill löschen?', body: '', affectedAgents: ['Invoicer'] },
        })

        const text = wrapper.text()
        expect(text).toContain('Das entfernt den Skill von 1 Agent: Invoicer')
        expect(text).toContain('Abbrechen')
        expect(text).toContain('Löschen')
    })

    it('renders a row in German', () => {
        const wrapper = mount(SkillRow, {
            props: { skill: makeSkill({ warning_count: 2 }), allowlist: [], agents: [{ id: 5, name: 'Invoicer' }] },
            global: { plugins: [pinia, stubRoutes()] },
        })

        const text = wrapper.text()
        expect(text).toContain('2 Warnungen')
        expect(text).toContain('2 Dateien')
        expect(text).toContain('geändert am')
    })

    it('writes the date with the German ordinal period', () => {
        // German orthography writes the day as an ordinal: "1. September", where
        // English writes "1 Sep" with no period.
        expect(updatedLabel('2026-09-01 14:02:00', Date.UTC(2026, 8, 30, 18, 0, 0))).toBe('1. September')
    })
})

describe('German catalogue → what it must not touch', () => {
    it('leaves the operator\'s own skill description alone', () => {
        const wrapper = mount(SkillRow, {
            props: { skill: makeSkill(), allowlist: [], agents: [] },
            global: { plugins: [pinia, stubRoutes()] },
        })

        // The description is model input the operator wrote: it reaches an agent, not a reader.
        expect(wrapper.text()).toContain('How to draft an invoice from a purchase order.')
    })

    it('leaves the tool registry\'s own names and descriptions alone', () => {
        const wrapper = mount(DeclaredToolsField, {
            props: {
                modelValue: 'agent',
                tools: makeTools(makeTool({ tool_name: 'read_url', display_name: 'Read URL', description: 'Does the example thing.' })),
            },
        })

        const text = wrapper.text()
        expect(text).toContain('Read URL')
        expect(text).toContain('Does the example thing.')
    })
})

describe('German catalogue → a locale without one', () => {
    it('falls back to the English source', () => {
        config.global.plugins = [createPluginI18n('fr')]

        const wrapper = mount(SkillSortSelect, {
            props: { id: 'sort', modelValue: 'updated', options: [] },
        })

        expect(wrapper.text()).toContain('Sort')
    })
})
