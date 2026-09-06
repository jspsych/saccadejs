# saccade.js documentation site

The user-facing docs at <https://jspsych.github.io/saccadejs/>. Built with
[Docusaurus](https://docusaurus.io/) on `@jspsych/docusaurus-preset`, the shared config factory
used by the other jsPsych-family satellite sites ([multiplayer](https://multiplayer.jspsych.org),
[metadata](https://metadata.jspsych.org)).

This is a **standalone project, deliberately not a workspace of the repo root** — it has its own
`package.json` and lockfile, so the docs dependency tree stays out of the published packages'
graph. Run every command below from `docs/`.

```sh
npm install
npm start      # dev server with hot reload
npm run build  # production build into build/
npm run serve  # preview the production build
npm run typecheck
```

## The core package is a build dependency

`docs/package.json` depends on `saccadejs` as `file:../packages/saccadejs`, which npm installs
as a symlink into `docs/node_modules/`. The [live demo page](docs/demo.mdx) imports it, so
**the site cannot build until the core package has been built**:

```sh
cd .. && npm install && npm run build --workspace=saccadejs
```

`dist/` is gitignored, so this applies to a fresh clone and to CI as well — see the build step
in `.github/workflows/publish-docs.yml`, which does exactly the above before installing the
docs. If you only want to edit prose, this is still required, because webpack resolves the
import at build time whether or not you visit the demo page.

## The model asset

The demo needs `eye_embedding.onnx` (about 20 MB). It is committed once, in
`packages/saccadejs/models/`, and `scripts/copy-model.mjs` copies it into `static/models/`
from the `predev`/`prebuild` scripts. The copy is gitignored (`docs/static/models/*.onnx` at the
repo root) so the file is never committed twice. The component references it with
`useBaseUrl("/models/eye_embedding.onnx")`, which resolves through `baseUrl`.

ONNX Runtime and MediaPipe assets are **not** copied: the core's defaults fetch them from
jsDelivr, which is what an experiment gets out of the box too. See
`docs/guides/hosting-the-assets.md`.

## Deployment

Pushing to `main` with changes under `docs/` **or `packages/saccadejs/`** triggers
`.github/workflows/publish-docs.yml`, which builds the core package, then typechecks and builds
the site, and publishes it to GitHub Pages. Pull requests touching either path build without
deploying, so a broken site is caught in review.

The core is in the trigger because the live demo bundles it: a core change makes the published
site stale even when nothing here moved.

The site is served from the project page, so `baseUrl` is `/saccadejs/` and `url` is
`https://jspsych.github.io`.

### Adding a custom domain later

There is **no `CNAME` file** yet, because there is no DNS record to point at. When there is
(`saccade.jspsych.org`, say):

1. **DNS.** Add a `CNAME` record for the subdomain pointing at `jspsych.github.io`. (For an
   apex domain, `A`/`AAAA` records to GitHub's Pages IPs instead.)
2. **`docs/static/CNAME`.** Create it containing exactly the hostname and nothing else:
   ```
   saccade.jspsych.org
   ```
   Docusaurus copies `static/` verbatim into `build/`, which is how GitHub Pages picks it up.
   Without this file, GitHub resets the custom domain on the next deploy.
3. **`docs/docusaurus.config.ts`.** Set `url: "https://saccade.jspsych.org"` and
   `baseUrl: "/"`. Both are wrong otherwise: `url` is used for canonical links, sitemaps and
   Open Graph tags, and `baseUrl` prefixes every asset path.
4. **Check the navbar.** `activeBaseRegex` on the Introduction item is written against the
   current base path (`^/saccadejs/$`); with `baseUrl: "/"` it becomes `^/$`.
5. Wait for GitHub to issue the certificate, then turn on **Enforce HTTPS** in the repository's
   Pages settings.

Leave `organizationName` and `projectName` alone — they identify the repository, not the domain.

## What goes here

Only **user-facing** documentation. Interface contracts and internal design notes live in
`CONTRACTS.md` at the repo root and are not published.

Content is in `docs/docs/`, matching the navbar:

| Path | Navbar |
| --- | --- |
| `introduction.md` | Introduction (the landing page — the site is docs-only, `routeBasePath: "/"`) |
| `demo.mdx` | Live demo |
| `getting-started.mdx` | Getting started |
| `guides/` | Guides |
| `reference/` | Reference |

`sidebars.ts` defines one sidebar per tab. Introduction and the demo are single pages linked
directly from the navbar and have no sidebar.

Components are in `src/components/`: `Steps` (the numbered walkthrough used in Getting started)
and `LiveDemo` (the demo itself).

## Notes for editors

- **The reference pages are derived from `CONTRACTS.md`.** If an interface changes, change the
  contract and the reference page together, or they drift apart silently.
- **`LiveDemo` is client-only.** It is wrapped in `<BrowserOnly>` and pulls `saccadejs` in with
  a dynamic `import()` inside an effect. Nothing in it may run during the static prerender —
  no module-scope reference to `window`, `navigator` or `HTMLVideoElement`.
- **`overrides.webpack` is pinned** in `package.json`. webpack ≥ 5.102 tightened the
  `ProgressPlugin` options schema, which Docusaurus 3.9's `webpackbar` fails validation
  against. Drop the override once that is fixed upstream. Docusaurus versions are pinned to
  3.9.2 to match what `@jspsych/docusaurus-preset` depends on; a mismatch nests a second copy
  of the classic preset and breaks the build.
- **The timing numbers in the docs are measurements, not estimates.** They come from the
  photodiode-and-LED rig validation recorded in the `eye-tracking` repository's
  `EXPERIMENT_LOG.md` (2026-09-05). If you restate them, restate them exactly, and say which
  convention they are on.
