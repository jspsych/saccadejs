---
"@saccadejs/core": minor
"@saccadejs/extension": minor
---

Experiment data now records which model produced the gaze, in a single `saccade_model`
column added once per session.

The tracker hashes the model bytes it actually loaded and looks that hash up in the registry
that ships with the core package. A value of `eye-embedding@1.0.0` therefore means *the bytes
matched that published release* — it is not copied from a URL or a filename, which is what
makes one column enough. A model that is not a published release is reported as
`sha256:<prefix>` rather than `unknown`, so custom weights still identify themselves.

Hashing costs one pass over the already-fetched bytes at startup. `crypto.subtle` needs a
secure context, but so does `getUserMedia` — any page that can reach a camera can hash.

New in core: `SaccadeTracker.getModelIdentity()` returns the full picture
(`{ sha256, version, contract, url, resolvedFrom, dim, emitsWeight }`), plus the
`ModelIdentity` type and the `formatModelIdentity()` helper the extension uses. The data column stays deliberately
minimal; the API is where to go for detail.

Only trials after the model loads carry the column — the camera is not touched until the
first `saccade-preview` trial or an explicit `start()`. Trials before that have no gaze data.
