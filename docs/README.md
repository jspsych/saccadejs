# saccade.js documentation site

The user-facing docs at <https://saccade.jspsych.org>. Built with
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

## The packages are build dependencies

`docs/package.json` depends on the core, the extension and all four plugins as
`file:../packages/<name>`, which npm installs as symlinks into `docs/node_modules/`. The
[live demo page](docs/demo.mdx) is a real jsPsych experiment that imports every one of them, so
**the site cannot build until the packages have been built**:

```sh
cd .. && npm install && npm run build
```

Every `dist/` is gitignored, so this applies to a fresh clone and to CI as well — see the build
step in `.github/workflows/publish-docs.yml`, which does exactly the above before installing
the docs. If you only want to edit prose, this is still required, because webpack resolves the
imports at build time whether or not you visit the demo page.

The demo also depends on `jspsych` and `@jspsych/plugin-html-keyboard-response` from npm: it
runs the same timeline as [Getting started](docs/getting-started.mdx), so what the demo
exercises is exactly what an experimenter installs.

## The static assets

Two files are copied into `static/` by the `predev`/`prebuild` scripts, and both copies are
gitignored so nothing is committed twice:

| Script | Copies | Why |
| --- | --- | --- |
| `scripts/copy-model.mjs` | `packages/core/models/eye_embedding.onnx` → `static/models/` | The demo fetches the ~20 MB model from the site's own origin, via `useBaseUrl("/models/eye_embedding.onnx")`, passed to the extension as `assets.modelUrl`. |
| `scripts/copy-jspsych-css.mjs` | `node_modules/jspsych/css/jspsych.css` → `static/css/` | The demo needs the real jsPsych stylesheet. *Importing* it would be simpler, but Docusaurus emits one stylesheet for the whole site and `jspsych.css` embeds Open Sans as base64 — ~460 kB on every page. `LiveDemo` links it from the demo page's `<Head>` instead. |

ONNX Runtime and MediaPipe assets are **not** copied: the core's defaults fetch them from
jsDelivr, which is what an experiment gets out of the box too. See
`docs/guides/hosting-the-assets.md`.

## Deployment

Pushing to `main` with changes under `docs/` **or `packages/`** triggers
`.github/workflows/publish-docs.yml`, which builds every package, then typechecks and builds
the site, and publishes it to GitHub Pages. Pull requests touching either path build without
deploying, so a broken site is caught in review.

`packages/` is in the trigger because the live demo runs them: a change to the extension or any
plugin makes the published site stale even when nothing here moved.

### The custom domain

The site is served at <https://saccade.jspsych.org>, so `baseUrl` is `/` and `url` is
`https://saccade.jspsych.org`. Four things hold that together, and changing any one alone
breaks it:

1. **DNS.** `saccade.jspsych.org` is a `CNAME` record pointing at `jspsych.github.io`. (An apex
   domain would need `A`/`AAAA` records to GitHub's Pages IPs instead.)
2. **The repository's Pages settings.** The custom domain must be registered on GitHub's side —
   DNS alone is not enough, because Pages routes by `Host` header and has to know which
   repository owns the name. Without it GitHub answers on the right IPs but returns a 404 and
   serves the wildcard `*.github.io` certificate.
3. **`docs/static/CNAME`.** Contains exactly the hostname and nothing else. Docusaurus copies
   `static/` verbatim into `build/`, and this deploys from an uploaded artifact rather than a
   branch, so without this file GitHub drops the custom domain on the next deploy.
4. **`docs/docusaurus.config.ts`.** `url` feeds canonical links, sitemaps and Open Graph tags;
   `baseUrl` prefixes every asset path. The Introduction navbar item's `activeBaseRegex` is
   written against the base path, so it is `^/$` here and would become `^/<prefix>/$` if the
   site ever moved back under one.

`organizationName` and `projectName` are unrelated to the domain — they identify the
repository, and stay as they are.

After a domain change, wait for GitHub to issue the certificate before turning on **Enforce
HTTPS** in the repository's Pages settings.

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
- **`LiveDemo` is a real jsPsych experiment, and client-only.** It runs the published extension
  and plugins on the same timeline as Getting started, rendered into a `<div>` by
  `initJsPsych({ display_element })`; React only supplies the intro screen, the annotation
  banner (driven from `on_trial_start`) and the summary. It is wrapped in `<BrowserOnly>` and
  pulls `jspsych` and every saccade.js package in with dynamic `import()`s inside a callback.
  Nothing in it may run during the static prerender — no module-scope reference to `window`,
  `navigator` or `HTMLVideoElement`, and no module-scope import of a package that touches them.
  Because the tracker holds an open camera, the component ends the experiment and calls the
  extension's `dispose()` on unmount and before a re-run.
- **`overrides.webpack` is pinned** in `package.json`. webpack ≥ 5.102 tightened the
  `ProgressPlugin` options schema, which Docusaurus 3.9's `webpackbar` fails validation
  against. Drop the override once that is fixed upstream. Docusaurus versions are pinned to
  3.9.2 to match what `@jspsych/docusaurus-preset` depends on; a mismatch nests a second copy
  of the classic preset and breaks the build.
- **The timing numbers in the docs are measurements, not estimates.** They come from the
  photodiode-and-LED rig validation recorded in the `eye-tracking` repository's
  `EXPERIMENT_LOG.md` (2026-09-05). If you restate them, restate them exactly, and say which
  convention they are on.
