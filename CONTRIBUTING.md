# Contributing to saccade.js

We welcome contributions of all kinds, including changes to the core library, the jsPsych
extension and plugins, and the documentation.

The project is managed entirely through the [GitHub repository](https://github.com/jspsych/saccadejs).
There you can:

- Use [issues](https://github.com/jspsych/saccadejs/issues) to report a bug, point out a
  problem in the docs, or propose a feature. If you have an idea you would like feedback on
  before writing code, open an issue and we'd love to chat about it!
- Submit a [pull request](https://github.com/jspsych/saccadejs/pulls) with changes to the
  codebase. Pull requests are reviewed by one or more members of the core team.

## Setting up

The repository is an npm workspaces monorepo. Each package lives under `packages/` and is built
with `@jspsych/config` (rollup, jest and tsconfig), the same tooling as the main jsPsych
repository.

```sh
npm install
npm run build
npm test
```

The built `dist/` folders are gitignored, so run `npm run build` after a fresh clone and after
changing a package that another package depends on.

## Guidelines for contributing

### Contributing to the codebase

We welcome contributions of any scope. Before we can merge changes, we generally require a few
things. You are welcome to open a pull request without all of them in place, but we can merge
your contribution sooner if you take care of the parts you are comfortable with.

- **The code must be tested through our automated testing system.** We use
  [Jest](https://jestjs.io/). Each package keeps its tests in `test/`. If you are fixing a bug,
  add a test case that shows the bug has been fixed. If you are adding a feature, add tests that
  cover it. CI runs the build and the full test suite on every push and pull request.

- **Code must be formatted with Prettier.** A pre-commit hook runs Prettier on staged files, so
  this normally happens on its own. The configuration (print width 100, sorted imports) is in
  the root `package.json`.

- **Public interfaces are documented in the code.** The code is the source of truth for the
  API. Give new core exports a doc comment, and give every new plugin parameter and data field
  a `description` in the plugin's `info` block.

- **Relevant documentation must be updated.** Any pages in `docs/docs/` affected by the change
  should be updated, and new pages created if needed. The reference pages in
  `docs/docs/reference/` are written by hand from the code, so a change to a parameter, a data
  field, or a core export needs a matching change there. Each package's `README.md` should stay
  accurate as well.

- **A changeset must be included in the pull request.** We use
  [changesets](https://github.com/changesets/changesets/blob/main/docs/adding-a-changeset.md)
  to version the packages and write their release notes. Run `npm run changeset`, choose the
  packages your change affects and the size of the bump, and describe the change for someone
  reading the changelog. Feel free to ask for help with this!

### Contributing to the documentation

We appreciate both small and large contributions to the documentation, from fixing a typo to
adding a whole new guide. The site at <https://saccade.jspsych.org> is built from the
[`docs/` folder](https://github.com/jspsych/saccadejs/tree/main/docs) with
[Docusaurus](https://docusaurus.io/). You can edit any of the Markdown files in `docs/docs/` and
submit a pull request.

To preview your changes locally, build the packages first (the live demo page imports them, so
the site cannot build without them), then start the docs dev server:

```sh
npm install && npm run build
cd docs
npm install
npm start
```

`docs/README.md` explains how the site is put together.

One rule is specific to this project: **recommend nothing the evidence does not support.** A
cutoff, a typical range, or a claim about what improves tracking accuracy needs a measurement
behind it. If you are unsure whether a claim is supported, ask in the pull request.

## Contributing a gaze model

saccade.js turns a picture of the eyes into an embedding with an ONNX model, then maps the
embedding to the screen with each participant's own calibration. The model is the only part
that can be swapped out. There are two ways to use a new one.

### Using your own model in your own studies

You don't need to contribute anything to do this. Set `assets.modelUrl` to your `.onnx` file.
[Using your own model](https://saccade.jspsych.org/models#using-your-own-model) on the docs site
explains what the model must accept and what it may return. In short:

- **The input is fixed.** It is a float32 tensor of shape `[1, 36, 144, 1]` holding values from
  0 to 255, built by the preprocessing in `packages/core/src/crop.ts`. Your training images must
  be prepared in exactly the same way. A model trained on images prepared differently will load
  and run, but its output will be nonsense, and saccade.js cannot detect this.
- **The outputs are flexible.** The first output is the embedding and can be any length. An
  optional second output, `cal_weight` with shape `[1, 1]` and values from 0 to 1, rates the
  quality of each frame. When it is present, saccade.js uses it to weight calibration.

The data records your model by its SHA-256 fingerprint in the `saccade_model` column, so every
run can be traced to the exact file it used.

### Proposing a model as a published release

The published releases are listed in `packages/core/models/releases.json` and served from the
docs site. Each version is served indefinitely, because experiments cite it by version. That is
a long-term commitment, so we publish a new model only when the evidence shows it is better.
**Open an issue before doing this work,** and include:

- **How it compares with the current release.** Report gaze error from the same validation
  protocol and participants, along with how well it does on held-out participants. Per-participant
  results are more useful than a single average.
- **What it costs participants.** Report the file size (the current model is about 20 MB) and the
  time per frame to compute an embedding, on both the WebGPU and the wasm backends, on ordinary
  hardware. The `saccade-performance` plugin's `embed_ms_median` measures the latter.
- **That it runs in the browser.** It must load in `onnxruntime-web` with both backends and pass
  the checks saccade.js runs at load time (see the docs page above).
- **Where it came from.** Describe the training data, code, run and checkpoint, so the
  `provenance` block of its `releases.json` entry can be filled in.

Please don't add or replace the model files, or edit `releases.json`, in a pull request. Each
release's export, fingerprint, and preprocessing `contractHash` are produced by the training
pipeline, so a maintainer will do this step.

**Version numbers follow the input and outputs, not the accuracy.** A retrained model with the
same input, the same preprocessing, and the same outputs is a minor release. Changing any of
those is a major release. This includes adding or removing `cal_weight`, which switches every
calibration between weighted and unweighted. A model that needs different preprocessing also
needs changes to `crop.ts` and its byte-for-byte tests, so discuss that in the issue first.
