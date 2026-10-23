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

- **Public interfaces must match `CONTRACTS.md`.** `CONTRACTS.md` defines the public API of
  every package. If your change adds or alters a parameter, a data field, or a core export,
  update `CONTRACTS.md` in the same pull request.

- **Relevant documentation must be updated.** Any pages in `docs/docs/` affected by the change
  should be updated, and new pages created if needed. The reference pages in
  `docs/docs/reference/` are derived from `CONTRACTS.md`, so change the two together. Each
  package's `README.md` should stay accurate as well.

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

## Contributing to the eye-embedding model

The ONNX model in `packages/core/models/` is trained and exported outside this repository, and
every published version stays served indefinitely because experiments cite it by version.
Please don't replace or edit the model files in a pull request. If you have found a problem
with the model or want to propose a change to it, open an issue.
