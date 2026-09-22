# @saccadejs/core

## 0.2.0

### Minor Changes

- [`8c6a2fa`](https://github.com/jspsych/saccadejs/commit/8c6a2faaf6598eb2e67d4ea33defbf4be8bca109) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Experiment data now records which model produced the gaze, in a single `saccade_model`
  column added once per session.

  The tracker hashes the model bytes it actually loaded and looks that hash up in the registry
  that ships with the core package. A value of `eye-embedding@1.0.0` therefore means _the bytes
  matched that published release_ — it is not copied from a URL or a filename, which is what
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

- [`bafc003`](https://github.com/jspsych/saccadejs/commit/bafc00389e78362d58be36bce37d262771b2dcae) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Renamed `tta` to `smoothing_frames` (`smoothingFrames` in the core), and changed its default from
  5 to 1.

  `tta` stood for test-time augmentation, which described the technique rather than the setting: the
  number is how many consecutive camera frames are averaged into one gaze estimate. It is now
  `SaccadeTrackerOptions.smoothingFrames` with `setSmoothingFrames` / `getSmoothingFrames`, the
  extension's `smoothing_frames` initialize parameter, and `saccade_timing.smoothing_frames` in the
  trial data.

  The default of 5 bought a steadier estimate at the cost of ~67 ms of lag at 30 fps, and it was
  paid silently by every experiment, including gaze-contingent ones that could least afford it. The
  default is now 1: predict from the newest frame, and let a study that wants smoothing ask for it.

  `saccade_timing.smoothing_frames` now reports what the tracker was actually smoothing over rather
  than the extension's parameter, so it stays true when you supply your own `tracker` or call
  `setSmoothingFrames` mid-experiment.

- [#2](https://github.com/jspsych/saccadejs/pull/2) [`f1ed9d7`](https://github.com/jspsych/saccadejs/commit/f1ed9d760daeb673c8b57a807763455e171261e8) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - The embedding width is no longer fixed at 128, and calibration row weighting now comes from the
  model rather than from the library.

  **Any consistent embedding width.** The ridge solve and both mean-embedding paths read their
  width from the embeddings they are handed instead of from a compile-time constant, so a model
  of any output length works, provided that length is the same on every frame of a session.
  `EMB_DIM` stays exported as the shipped model's width, for reference rather than as a
  requirement. The crop
  side is unchanged and still exact: 36x144 gray, built by the preprocessing in `crop.ts`.

  **Calibration weights now come from the model.** A model may carry a per-frame quality score
  as a second graph output — `cal_weight`, sigmoid, in [0, 1]. The tracker weights the frames
  making up a calibration point's mean embedding by it, then averages it into that point's row
  weight in the fit. eye-embedding 1.0.0 now includes one.

  This removes a way for the weighting and the embedding to disagree. The model is fetched by
  URL at runtime, while the previous weights file was compiled into whichever `@saccadejs/core`
  a study installed, and the two version numbers move independently — so a study could pin one
  model version and score it with a different one's head. The sha256 that identifies the model
  now covers the head as well.

  `CAL_HEAD` is no longer applied automatically. It remains exported, and
  `SaccadeTrackerOptions.calHead` opts back into it; the default is the model's own weights, or
  none. `fitCalibration()` returns `weighting: "model" | "head" | "uniform"` saying which ran,
  `saccade-calibrate` records it as a `weighting` column, and `EmbeddingModel.embed()` resolves
  to `{ embedding, weight }`, which keeps the weight paired with the embedding it describes.

  **Five silent failures now throw.** A `CalHead` whose length did not match the embedding read
  past the end of its kernel and turned every coefficient of the fit into NaN, with no error
  anywhere; it throws now. So do an embedding whose width changes mid-session, a ragged set of
  calibration rows, a half-weighted calibration set (defaulting the unweighted points to 1 made
  them the highest-weighted rows in the fit), and a weight output that is not a finite number in
  [0, 1]. The last throws at `init()`, on the warm-up inference, before any participant data
  exists.

- [`d65654e`](https://github.com/jspsych/saccadejs/commit/d65654e95b406da868571b44722488422fede6ed) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Fixed the setup progress bar never moving when the page builds its own tracker and hands it to
  the extension through the `tracker` parameter. The extension only heard progress from a tracker
  it had built, so `saccade-preview` sat at "Starting…" until init finished. On a first visit
  that is a download of about 60 MB, which looked like a hang.

  `SaccadeTracker` now has `onProgress(cb)`, a subscription to `init()`'s load progress that
  works like `onFrame(cb)`. It delivers the most recent report straight away and returns the
  unsubscribe function. The extension subscribes through it whichever way it got its tracker.

### Patch Changes

- [`d65654e`](https://github.com/jspsych/saccadejs/commit/d65654e95b406da868571b44722488422fede6ed) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Fixed the eye-model download reporting the wrong total. GitHub Pages and jsDelivr compress the
  `.onnx` for browsers, so `Content-Length` is the compressed size, while the byte count is the
  file's. Against the site's model the bar filled early and the label read "20.6 / 19.0 MB".

  For a published release (the package's own model, or a versioned URL such as
  `/models/eye-embedding/1.0.0/eye_embedding.onnx`), `total` now comes from
  `models/releases.json`. Otherwise `Content-Length` is used only for an uncompressed response,
  and a total the byte count runs past is dropped. `saccade-preview`'s bar no longer moves
  backwards when that happens.

- [#2](https://github.com/jspsych/saccadejs/pull/2) [`f98f555`](https://github.com/jspsych/saccadejs/commit/f98f5551345861d17a4a4387c50d05a77ae2fba8) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - eye-embedding 1.0.0 now exports two outputs: the `embedding`, and `cal_weight`, the trained
  per-frame calibration weight that previously shipped beside the model as JSON.

  The embedding is bit-identical to the earlier pre-release export, verified across the whole
  parity fixture set, so gaze from this model is unchanged. The calibration weighting is now part
  of the bytes the model's sha256 identifies, rather than a file compiled into a package whose
  version moves independently of the model's.

  The head is not retrained. It was always `Dense(1, sigmoid)` over one image's embedding; the
  export re-uses that trained layer on a single crop rather than a `(batch, targets, dim)` stack.
  This also corrects a training/inference mismatch, since the library used to apply that
  per-image head to a mean over a whole capture window — something training never did.

- [`c0b5488`](https://github.com/jspsych/saccadejs/commit/c0b54881f07f9fc9bba969083e6c4a54bda4707c) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Every published model version now stays served, not just the newest.

  `copy-model.mjs` staged only the most recent release, so the moment a second version existed
  the first one's URL would have 404ed — a versioned URL that stops resolving is worse than one
  never published, because by then it is in someone's methods section. It now stages every
  release marked `served`, verifies each one's sha256, and **fails the build** if a served
  version has lost its file.

  Model files are ~20 MB and sit on the same infrastructure as the docs site, so the policy is
  to keep every version up indefinitely; `served: false` is for a deliberate withdrawal, not
  housekeeping. Superseded versions live at `models/<version>/eye_embedding.onnx` while the
  current one stays at `models/eye_embedding.onnx`, where `assets.ts` resolves it for bundler
  users; each release's `file` field names where its bytes are.

- [`048929e`](https://github.com/jspsych/saccadejs/commit/048929ecf907fcc649dca47da5b2b1e69918410f) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Added `models/releases.json`, a registry describing every published version of the
  eye-embedding model: its version, sha256, size, preprocessing contract, ONNX I/O, and the
  W&B checkpoint it came from.

  The registry ships with the package and is importable as
  `@saccadejs/core/models/releases.json`, so a consumer can check which model version their
  installed core expects without trusting a filename. (The `exports` map now also lists
  `./package.json`, which tooling commonly asks for.) It is also what the docs site builds its
  `/models` page from, and what lets the site serve each release from a versioned URL —
  `/models/eye-embedding/1.0.0/eye_embedding.onnx`. Versioned URLs are the only ones the site
  serves: an unversioned "latest" path would change under a running study without saying so.

  Model version is independent of the package version: patch/minor means new weights behind an
  identical interface, major means the preprocessing contract changed.
