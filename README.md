# spora-plugin-custom-skills-frontend

Vue 3 IIFE bundle for the Spora **Custom Skills** admin panel. The host SPA
lazy-loads it at `/plugins/custom-skills/main.js` and mounts it into the
`/apps/custom-skills` slot via the global `window.SporaAppCustomSkills`.

The PHP half of the panel lives in `spora-plugin-custom-skills`; this repo
ships only the built assets. The REST contract both halves speak is published at
<https://docs.spora-ai.com/reference/api#custom-skills-spora-plugin-custom-skills>
— read it before changing anything under `src/api/`.

## What the panel does

**One page per destination, each with a subject of its own.** The panel used to be
a workspace: one route rendering the editor above two lists, a second route pushing
a name into the same screen, and a query param for the third case. That holds only
while there is exactly one thing to do.

| Route | Page | Source | Mutability |
|---|---|---|---|
| `/` | Home — what this principal owns | `GET /api/v1/custom-skills` (this plugin) | navigates |
| `/new` | Create — a name, then the desk | `POST /api/v1/custom-skills` | writes once |
| `/skills/:name` | Desk — write | `GET`/`PUT`/`DELETE /api/v1/custom-skills/{name}` | full CRUD + restore |
| `/library` | Catalogue — every shipped skill | `GET /api/v1/skills` (the **host**) | read-only + *Duplicate* |
| `/library/:name` | Viewer — read a shipped skill | `GET /api/v1/skills/{name}` + `…/files/{path}` per sidecar (the **host**) | read-only |

Three routing decisions worth defending:

- **`/skills/:name` and `/library/:name` are separate routes**, not one route with
  a `?view=` query. A shipped skill is a global, read-only resource; a custom one
  is principal-scoped and writable. Different URLs make that structural difference
  visible instead of hiding it behind a query string.
- **`/new` is top-level, not `/skills/new`**, which would shadow a skill literally
  named `new` — a legal slug under the contract.
- **The principal is not in the URL.** It lives in the Pinia store, and a scope
  change navigates to home: the desk's URL says `invoice-drafting` and nothing
  about whose it is, so re-pointing it at another principal's identically-named
  skill mid-edit is the worst outcome the routing enables.

Pre-shipped skills are served by `spora-core`'s `SkillController`, which has
three routes (`index`, `show`, `file`). The frozen contract lists them under
"Not endpoints (deliberately)": this plugin must never re-serve them, or the
two copies drift. `file` is how a sidecar's contents are read — the detail route
lists a sidecar's path and size but serves only the `SKILL.md` body, so a viewer
cannot open anything else without it.

### The four affordances

Each of these exists because its absence produces a support ticket, not because
it is a nice-to-have:

1. **The principal is always visible.** A sticky bar on every page, carrying a
   skill count per entry. A row of equal-weight chips reads as *filters*, and a
   filter chip does not say "everything below belongs to what I picked". The
   contract returns one principal's skills per call and has no count endpoint, so
   each entry is its own `GET /custom-skills?principal_id=N`, read on open.
2. **Validation feedback** — a rejected write answers 422 `SKILL_INVALID` with
   a `ValidationResult` array. `SkillDesk.vue` renders each entry *under the
   field its `path` names*; warnings, plus any error no field claims, go to a
   banner. Nothing the validator said is dropped.
3. **Fork from pre-shipped** — every shipped row has **Duplicate**. Without it the
   only path to a first skill is a blank editor, and the shipped skills are exactly
   the worked examples people copy from. Forks always get a non-reserved name
   (`forkName()`); a shipped slug answers 409 `SKILL_NAME_RESERVED`.
4. **Allowlist affordance** — a row's menu lists the agents that currently resolve
   it (from `GET …/{name}/allowlist`, read when the menu opens) and offers
   **Enable on agent…**, which writes the agent's `skill` tool `allowed_skills`
   override. The empty state reads *"Not enabled for any agent yet — add it to an
   agent's Skill tool settings before the agent can use it."* — the operator
   otherwise discovers the problem only when the agent replies *"Skill 'x' is not
   in the allowed_skills list for this agent."*

Plus: deleting a skill is a **multi-agent config change**, so the confirmation
dialog reads the allowlist *before* the write and names the agents that will be
scrubbed (`store.requestDelete()`). `scrubbed_agents` on the delete *response* is
only used to report what actually changed — it arrives too late to warn anyone.

### There is no in-panel search

Deliberately. A ⌘K palette already exists one layer up and covers agents, groups
and chats. A second search box inside a plugin panel is not a shortcut to the same
thing — it is two search boxes that disagree, and this one would be strictly
narrower, since the store only ever holds the *selected* principal's skills, so
"search" would quietly mean "search what happens to be in memory". The panel is
sorted-and-scrolled instead: every list has a sort control, and "recently used" is
not one of the options because nothing records a skill's last invocation.

## Layout

```
src/
  main.ts            mount/unmount contract, plugin-local Pinia + the route map
  App.vue            the layout: scope bar, banners, delete dialog, <RouterView>
  shims.ts           PluginHostContext + injection key + the window global
  types.ts           CustomSkillResource and friends, field-for-field with the contract
  api/
    client.ts        bridge to the host's typed REST client (setApi/getApi/ApiError)
    customSkills.ts  CRUD, restore, allowlist, sidecar read, fork
    preshippedSkills.ts  the HOST catalogue (read-only) + per-sidecar read
    agentAllowlist.ts    per-agent `allowed_skills` read-modify-write
    agents.ts / principals.ts
  stores/
    skills.ts        loading / saving / error / notice, the delete confirmation,
                     per-principal counts
    principals.ts    the acting principal
  lib/skillFormat.ts pure derivations: validator path → field, provenance label,
                     fork name, slug rule, relative timestamps, sort orders
  pages/             HomePage, CreateSkillPage, SkillDeskPage, CataloguePage,
                     SkillViewerPage
  components/        PrincipalScopeBar, SkillRow, SkillSortSelect, SkillDesk,
                     SkillViewer, ConfirmDialog, AlertBanner
```

## Responsive rule

**The scope bar wraps** and stays sticky. **The desk stacks below `md` and splits
above it**, and the split says so with an explicit base `flex-col` plus
`md:flex-row` — a direction variant with no base direction resolves to the CSS
initial `row` and silently disables every `md:` sizing on the rail beside it.
The rail is **not** hidden at any width: it is capped at `38vh` and scrolls inside
that, so a skill with a dozen sidecars cannot push the editor off the bottom of the
window, and a file `<select>` in the footer is the second way to name the open file
in a narrow one. **The desk's preview is not responsive**: `MdEditor` owns it
through `:preview="true"` plus the toolbar's own `preview` / `previewOnly`
entries, so there is no panel-level mode group to make responsive. **The
catalogue's per-row file count and licence are always shown**; the row wraps its
actions onto their own line below `sm` rather than dropping the meta.

## The scope root carries no utility classes

`tailwind.config.ts` sets `important: '#spora-plugin-custom-skills'`, which
compiles to a **descendant** selector — `#spora-plugin-custom-skills .flex`. That
cannot match the element carrying the id, so a utility class on the panel root is
dead CSS that still reads correctly in the source, and the root falls back to a
content-sized block. That in turn leaves the desk's `h-full` resolving against an
auto-height parent, which is the whole reason the page once grew to five viewports.

The root's frame (`display: flex`, `min-height: 100vh`, the background token) is
therefore hand-written in `src/style.css`, which is emitted verbatim rather than
through the prefix. `tests/buildAssets.spec.ts` asserts both halves of this: the
prefix stays a descendant selector, and the root carries no class. If the prefix
ever changes to something that matches the scope element, those tests are what
should make you notice.

## Host globals contract

`vite.config.ts` externalises **four** modules and maps them to host globals:

| Module | Global | Published by the host? |
|---|---|---|
| `vue` | `window.Vue` | yes (`publishPluginGlobals`) |
| `pinia` | `window.Pinia` | yes |
| `vue-router` | `window.VueRouter` | yes |
| `md-editor-v3` | `window.MdEditorV3` | yes |

`spora-frontend/src/utils/publishPluginGlobals.ts` publishes exactly **five**
globals: `Vue`, `Pinia`, `VueRouter`, `VueDraggablePlus` and `MdEditorV3`. Four
of them are consumed by this bundle; `VueDraggablePlus` is published for other
plugins.

`lucide-vue-next` and `dompurify` are **bundled, not externalised**, and must
stay that way. The host does not publish them, and a bundle that externalises
an unpublished global does not degrade — it throws while the IIFE argument list
is being resolved, so `window.SporaAppCustomSkills` is never assigned and the
panel is *unreachable*. `spora-plugin-memories-frontend` bundles the same two
for the same reason; match it.

`output.extend` must stay **off**. The host loads this bundle through a dynamic
`import()`, where module scope is `undefined`, so `extend: true` emits
`this.SporaAppCustomSkills = …` and throws before the real global is ever
assigned. `scripts/smoke.js` fails the build on that wrapper shape.

Two signals mean the contract drifted:

- `scripts/smoke.js` failing to find `window.Vue` / `window.Pinia` /
  `window.VueRouter` / `window.MdEditorV3` in the bundle — an external got
  inlined or dropped.
- `frontend/main.js` shrinking by roughly 60 KB — the two deliberately-bundled
  libraries got externalised.
- `tests/buildAssets.spec.ts` failing on the externals list, or on a hand-written
  selector in `src/style.css` that is not scoped by hand.

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
  validation capture, allowlist cache, the read-then-write delete confirmation,
  per-principal counts, and that no duplicate helper survived on the store (the
  Duplicate buttons navigate instead).
- `tests/components/PrincipalScopeBar.spec.ts` — the scope dropdown, its per-entry
  counts, and that a scope change lands on home.
- `tests/components/SkillRow.spec.ts` — what a row claims at rest, and the menu's
  allowlist read including that it claims nothing until that read lands.
- `tests/components/FileDialog.spec.ts` — the conventional-folder hint renders as
  text, not as markup.
- `tests/components/SkillDesk.spec.ts` — `SKILL.md` unremovable, the pane's
  nesting (not just its class names), the desk root carrying no direction variant,
  the save payload, inline errors vs. banner warnings.
- `tests/buildAssets.spec.ts` — the built stylesheet: every hand-written selector
  inside the plugin boundary, the scope prefix still a descendant selector, and
  the scope root carrying no utility class.
- `tests/components/SkillViewer.spec.ts` — the read-only inspector, that reading
  cannot mutate, and the on-demand sidecar read (once per path, never in a loop).
- `tests/pages/SkillViewerPage.spec.ts` — `/library/:name`: a sidecar is fetched when
  opened, a failed read is stated rather than blank, and no read leaks across a skill
  change.
- `tests/lib/skillFormat.spec.ts` — the pure derivations, including the local
  mirror of the server's slug rule.
- `tests/pages/*.spec.ts` — one per destination, plus the two bootstrap
  reproductions: the create form requiring a name, and the "New skill did nothing"
  report.
- `tests/buildAssets.spec.ts` — the externals list against the host's published
  globals, and the hand-written CSS staying inside the plugin boundary.
- `tests/tailwind-host-tokens.spec.ts` — the plugin's colour tokens against the
  host's `:root`.
- `tests/main-mount.spec.ts` — the `mount` / `unmount` contract.

`md-editor-v3` is stubbed in `tests/setup.ts` (CodeMirror 6 + highlight.js +
katex + mermaid do not run under happy-dom). `lucide-vue-next` and `dompurify`
are the real modules in tests, so the sanitiser assertion stays meaningful.

Page specs mount through `tests/mountPage.ts`, which installs the real Pinia and
the real route map: the panel is page-per-destination, so a page mounted without a
router renders its `RouterLink`s as bare elements and reads `START_LOCATION`.

## Releasing

See [RELEASING.md](./RELEASING.md). In short: bump `package.json` **and**
`composer.json` (including `dist.url`), then tag `v<version>`. The
`build-and-release` job fails if `dist.url` does not match the tag.
