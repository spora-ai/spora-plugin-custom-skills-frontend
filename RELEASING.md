# Releasing spora-plugin-custom-skills-frontend

This package is published on Packagist as `spora-ai/spora-plugin-custom-skills-frontend`. Releases use GitHub Releases for the asset tarball; Packagist indexes from the git tag, so the `dist.url` in the **tagged** `composer.json` must point at the correct asset.

## Release process

1. **Open a release prep PR** against `main`:
   - Bump `package.json` `version` to the next semver (e.g. `0.1.1`)
   - Update `composer.json` `dist.url` to the matching URL:
     ```
     https://github.com/spora-ai/spora-plugin-custom-skills-frontend/releases/download/v<VERSION>/spora-plugin-custom-skills-frontend-v<VERSION>.tar.gz
     ```
   - Update `README.md` if the host globals contract changed
2. **Merge the PR** to `main`.
3. **Tag the merge commit** from `main`:
   ```bash
   git checkout main && git pull --ff-only
   git tag v<VERSION>    # e.g. v0.1.1
   git push origin v<VERSION>
   ```
4. The `build-and-release` workflow fires:
   - Builds the bundle (`vue-tsc && vite build`)
   - Verifies the tagged `composer.json`'s `dist.url` matches the tag (fails loudly if not)
   - Verifies the artifact contains only `frontend/` contents (no source code, configs, or `node_modules`)
   - Creates the GitHub Release with the asset attached
5. Packagist auto-indexes the new tag within ~5 minutes.

## Release artifact shape

The GitHub Release asset (`spora-plugin-custom-skills-frontend-v<VERSION>.tar.gz`) contains **the `frontend/` directory verbatim** (the Vite IIFE bundle output — `main.js` and `style.css`), under a single versioned root directory that matches the tag:

```
spora-plugin-custom-skills-frontend-v<VERSION>.tar.gz
└── spora-plugin-custom-skills-frontend-v<VERSION>/     # versioned root — required by PHP's PharData
    └── frontend/                                        # preserved as a subdir so the installer can find it
        ├── main.js                                      # the IIFE bundle (window.SporaAppCustomSkills = ...)
        └── style.css                                    # Tailwind utilities scoped to #spora-plugin-custom-skills
```

**Nothing else ships in the archive** — no source files, no `package.json`, no `node_modules`, no build configs. The release tarball is built explicitly from `frontend/` in the `build-and-release` workflow, and the `Verify only frontend/ is shipped` step in the same workflow fails the build if any non-`frontend/` path slips into the archive (deny-list + allow-list assertions).

Both entries are **required** here, unlike in the memories plugin: `App.vue` imports `src/style.css` and `SkillEditor.vue` imports `md-editor-v3/lib/style.css`, so Vite always emits a stylesheet. A missing `frontend/style.css` means the plugin's Tailwind utilities vanished and the panel renders unstyled in the host — the `build` job fails on it explicitly.

The installer in `spora-ai/installer` (any 1.x release) unpacks this tarball into `public/plugins/custom-skills/` on the operator's host, so the host SPA's dynamic `import('/plugins/custom-skills/main.js')` (per `registry.ts → mountPlugin`) finds the IIFE bundle at the path it expects.

The versioned root is **load-bearing** — see "Why a versioned root directory" below.

Note: `composer.json`'s `archive.exclude` block is **only consumed by `composer archive`** — it has no effect on the GitHub Release tarball, which is built by the CI workflow directly from `frontend/`. It's there as defense-in-depth so a maintainer running `composer archive` locally doesn't accidentally ship source files in a one-off manual release.

## Why a versioned root directory

Composer's `TarDownloader` uses PHP's `PharData::extractTo()` internally, which fails with `Cannot extract '.', internal error` on the leading `.` directory entry. PHP requires the archive to have a non-trivial root directory.

The fix is to wrap the contents in a versioned root before tarring:

```bash
mkdir -p staging/spora-plugin-custom-skills-frontend-${TAG}
cp -R frontend/. staging/spora-plugin-custom-skills-frontend-${TAG}/
tar -czf spora-plugin-custom-skills-frontend-${TAG}.tar.gz -C staging spora-plugin-custom-skills-frontend-${TAG}
```

This produces `spora-plugin-custom-skills-frontend-v<X.Y.Z>/…` entries.

## Why this is the process

`composer install` reads `dist.url` from the **tagged** `composer.json`, not from the CI workspace. If you skip the prep PR and just tag the old `composer.json`, `composer install` will resolve the URL to a 404 because the new release asset doesn't exist at the old URL.

## Rollback

If a release is broken, do NOT delete + retag the same version. Git tags are immutable. Instead, tag a new patch version (e.g. `v0.1.0` → `v0.1.1`) with the fix.

## Cross-repo contract to re-check before any release

`spora-frontend/src/utils/publishPluginGlobals.ts` publishes exactly five globals: `Vue`, `Pinia`, `VueRouter`, `VueDraggablePlus` and `MdEditorV3`. This bundle externalises the first, second, third and fifth — see README → "Host globals contract".

`lucide-vue-next` and `dompurify` are **deliberately bundled**, not externalised: the host does not publish them, and externalising an unpublished global makes the IIFE throw while resolving its argument list. That is a hard load failure, not a degraded panel — `window.SporaAppCustomSkills` is never assigned. If a future change adds either to `rollupOptions.external`, the release is broken.

Before cutting the tag, confirm the host still publishes all four globals this bundle depends on. If one is dropped, the panel stops mounting and the size budget drops by roughly 60 KB.

## First release checklist (v0.1.0)

The v0.1.0 release declares `extra.spora-plugin-slug = "custom-skills"` in `composer.json` so `SporaPluginFrontendInstaller` (in `spora-installer`) routes the bundle to `public/plugins/custom-skills/` — matching the slug emitted by the plugin's `plugin.json#slug` and consumed by the host SPA's `/plugins/<slug>/main.js` lazy-load. Without this field, the install fails loud. Confirm:

- [x] `spora-frontend` publishes the four globals this bundle externalises: `Vue`, `Pinia`, `VueRouter`, `MdEditorV3` (plus `VueDraggablePlus`, which this bundle does not use)
- [ ] `package.json` `version` is `0.1.0`
- [ ] `composer.json` `dist.url` is `https://github.com/spora-ai/spora-plugin-custom-skills-frontend/releases/download/v0.1.0/spora-plugin-custom-skills-frontend-v0.1.0.tar.gz`
- [ ] `composer.json` `extra.spora-plugin-slug` is `"custom-skills"` (matches `plugin.json#slug` in `spora-plugin-custom-skills`)
- [ ] `ci.yml` `Verify only frontend/ is shipped` still expects `frontend/main.js` **and** `frontend/style.css` under the versioned root
- [ ] SonarCloud gate green on the `main` HEAD
- [ ] Lint + Static analysis + Code style + Test + Build + Size budget jobs green on the `main` HEAD
