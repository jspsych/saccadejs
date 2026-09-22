# @saccadejs/plugin-preview

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
