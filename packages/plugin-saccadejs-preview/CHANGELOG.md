# @saccadejs/plugin-preview

## 0.2.0

### Minor Changes

- [#6](https://github.com/jspsych/saccadejs/pull/6) [`1423c30`](https://github.com/jspsych/saccadejs/commit/1423c304038404a646251db9af44b779dbb4d4d5) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Participant-facing wording in the preview trial:

  - The face indicator reads "Face found" or "Looking for your face…" instead of "face: yes/no".
  - The loading labels describe what the participant is waiting for. For example, "Downloading the eye tracker (12.3 of 20.6 MB)…" replaces "Downloading eye model 12.3 / 20.6 MB", and "Starting the model runtime" is now "Loading…".
  - The frame rate and execution provider are hidden unless the new `show_diagnostics` parameter is `true`. Both are still recorded in the data.
  - The loading note and the failure message are reworded in plain language.

## 0.1.1

### Patch Changes

- [`d65654e`](https://github.com/jspsych/saccadejs/commit/d65654e95b406da868571b44722488422fede6ed) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Fixed the eye-model download reporting the wrong total. GitHub Pages and jsDelivr compress the
  `.onnx` for browsers, so `Content-Length` is the compressed size, while the byte count is the
  file's. Against the site's model the bar filled early and the label read "20.6 / 19.0 MB".

  For a published release (the package's own model, or a versioned URL such as
  `/models/eye-embedding/1.0.0/eye_embedding.onnx`), `total` now comes from
  `models/releases.json`. Otherwise `Content-Length` is used only for an uncompressed response,
  and a total the byte count runs past is dropped. `saccade-preview`'s bar no longer moves
  backwards when that happens.
