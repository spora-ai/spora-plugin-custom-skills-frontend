# spora-plugin-custom-skills-frontend

Vue 3 IIFE bundle for the Spora **Custom Skills** admin panel. The host SPA
lazy-loads it at `/plugins/custom-skills/main.js` and mounts it into the
`/apps/custom-skills` slot via the global `window.SporaAppCustomSkills`.

The PHP half of the panel lives in `spora-plugin-custom-skills`; this repo
ships only the built assets. The REST contract both halves speak is frozen in
`spora-workspace/plans/custom-skills-rest-contract.md` — read it before
changing anything under `src/api/`.

## What the panel does

Two panes, split by **provenance** rather than by feature:

| Pane | Source | Mutability |
|---|---|---|
| **My skills** | `GET /api/v1/custom-skills` (this plugin) | full CRUD + restore |
| **Pre-shipped** | `GET /api/v1/skills` (the **host**, not this plugin) | read-only + *Duplicate* |

Pre-shipped skills are served by `spora-core`'s `SkillController`, which has
exactly two routes (`index`, `show`). The frozen contract lists them under
"Not endpoints (deliberately)": this plugin must never re-serve them, or the
two copies drift.

### The three affordances

Each of these exists because its absence produces a support ticket, not because
it is a nice-to-have:

1. **Validation feedback** — a rejected write answers 422 `SKILL_INVALID` with
   a `ValidationResult` array. `SkillEditor.vue` renders each entry *under the
   field its `path` names*; warnings, plus any error no field claims, go to a
   banner. Nothing the validator said is dropped.
2. **Fork from pre-shipped** — every shipped card has **Duplicate**. Without it
   the only path to a first skill is a blank editor, and the shipped skills are
   exactly the worked examples people copy from. Forks always get a
   non-reserved name (`forkName()`); a shipped slug answers
   409 `SKILL_NAME_RESERVED`.
3. **Allowlist affordance** — each custom-skill card lists the agents that
   currently resolve it (from `GET …/{name}/allowlist`) and offers
   **Enable on agent…**, which writes the agent's `skill` tool
   `allowed_skills` override. The empty state reads *"Not enabled for any agent
   yet — add it to an agent's Skill tool settings before the agent can use it."*
   — the operator otherwise discovers the problem only when the agent replies
   *"Skill 'x' is not in the allowed_skills list for this agent."*

Plus: deleting a skill is a **multi-agent config change**, so the confirmation
dialog reads the allowlist *before* the write and names the agents that will be
scrubbed. `scrubbed_agents` on the delete *response* is only used to report
what actually changed — it arrives too late to warn anyone.

## Layout

```
src/
  main.ts            mount/unmount contract, plugin-local Pinia + memory-history router
  App.vue            #spora-plugin-custom-skills CSS scope root
  shims.ts           PluginHostContext + injection key + the window global
  types.ts           CustomSkillResource and friends, field-for-field with the contract
  api/
    client.ts        bridge to the host's typed REST client (setApi/getApi/ApiError)
    customSkills.ts  CRUD, restore, allowlist, sidecar read, fork
    preshippedSkills.ts  the HOST catalogue (read-only)
    agentAllowlist.ts    per-agent `allowed_skills` read-modify-write
    agents.ts / principals.ts
  stores/
    skills.ts        loading / preShippedLoading / saving / error, validationErrors
    principals.ts    the scope chip row's selection
  lib/skillFormat.ts pure derivations (validator path → field, provenance label, fork name)
  pages/SkillsPage.vue
  components/        SkillEditor, SkillCard, PreShippedSkillCard, ConfirmDialog,
                     PaneSearch, PrincipalChipRow, AlertBanner
```

## Responsive rule

**Under `lg` the two panes stack, "My skills" first** (every write happens
there), and the editor drops out of flow into a full-width panel below them.
At `lg` and up they sit side by side in a fixed 2-column grid. The breakpoint
is `lg`, not `md`: each card carries a description, a file manifest and an
allowlist row, and at `md` the pre-shipped pane's cards compress past the point
where **Duplicate** is reachable without horizontal scrolling.

## Host globals contract

`vite.config.ts` externalises six modules and maps them to host globals:

| Module | Global | Published by the host? |
|---|---|---|
| `vue` | `window.Vue` | yes (`publishPluginGlobals`) |
| `pinia` | `window.Pinia` | yes |
| `vue-router` | `window.VueRouter` | yes |
| `md-editor-v3` | `window.MdEditorV3` | yes |
| `lucide-vue-next` | `window.LucideVueNext` | **no** |
| `dompurify` | `window.DOMPurify` | **no** |

> **Known gap.** `spora-frontend/src/utils/publishPluginGlobals.ts` currently
> publishes only `Vue`, `Pinia`, `VueRouter`, `VueDraggablePlus` and
> `MdEditorV3`. Until it also publishes `LucideVueNext` and `DOMPurify`, the
> two mappings resolve to `undefined` and the IIFE throws at load.
> `spora-frontend` has both as dependencies already; adding the two lines is
> the fix. `scripts/smoke.js` asserts the four published globals are still
> wired, and the `frontend/` size budget would drop by ~60 KB if the other
> two were inlined instead — either signal means the contract drifted.

## Commands

```bash
npm install
npm run dev            # standalone sandbox on :5190 with in-memory fixtures
npm run lint           # eslint
npm run typecheck      # vue-tsc --noEmit
npm test               # vitest run
npm run test:coverage  # vitest run --coverage → coverage/lcov.info
npm run build          # vue-tsc --noEmit && vite build → frontend/
npm run smoke          # asserts the IIFE + the #spora-plugin-custom-skills CSS scope
npm run clean          # removes frontend/main.js + frontend/style.css
```

`npm run build` writes `frontend/main.js` and `frontend/style.css`.
`SporaPluginFrontendInstaller` copies that directory verbatim into
`public/plugins/custom-skills/` at install time — do not rename either file.

## Tests

- `tests/api/customSkills.spec.ts` — the real client against a stubbed host
  `api`, asserting every path, query string and envelope unwrap.
- `tests/api/hostSurfaces.spec.ts` — pre-shipped catalogue, `allowed_skills`
  read-modify-write, agents, principals.
- `tests/stores/skills.spec.ts` — the loading triple, in-place updates,
  validation capture, allowlist cache.
- `tests/components/SkillEditor.spec.ts` — inline errors vs. banner warnings,
  provenance label, restore visibility, save payload shape.
- `tests/lib/skillFormat.spec.ts` — the pure derivations.
- `tests/pages/SkillsPage.spec.ts` — empty states, per-pane search, source
  grouping, and the read-before-write ordering of the delete blast radius.
- `tests/main-mount.spec.ts` — the `mount` / `unmount` contract.

`md-editor-v3` is stubbed in `tests/setup.ts` (CodeMirror 6 + highlight.js +
katex + mermaid do not run under happy-dom). `lucide-vue-next` and `dompurify`
are the real modules in tests, so the sanitiser assertion stays meaningful.

## Releasing

See [RELEASING.md](./RELEASING.md). In short: bump `package.json` **and**
`composer.json` (including `dist.url`), then tag `v<version>`. The
`build-and-release` job fails if `dist.url` does not match the tag.
