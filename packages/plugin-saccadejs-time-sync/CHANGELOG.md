# @saccadejs/plugin-time-sync

## 1.0.0

### Major Changes

- [#22](https://github.com/jspsych/saccadejs/pull/22) [`6cd875d`](https://github.com/jspsych/saccadejs/commit/6cd875db9e28495cbcfc492c5ee0006d9ca70f3e) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - SaccadeJS 1.0. The packages now follow semantic versioning: a breaking change to any of them means a new major version.

  Every package now requires the 1.x versions of the others. The extension and `saccade-time-sync` take `@saccadejs/core` `^1.0.0` (previously any version), and every plugin takes `@saccadejs/extension` `^1.0.0` (previously `>=0.1.0`, or `>=0.4.0` for `saccade-catch-up`).

  Two extension methods changed:

  - `calibratePoint(x, y, options?)` takes an options object in place of its three optional positional arguments: `calibratePoint(x, y, { embeddings, captureMs, timeoutMs })`. Replace `calibratePoint(x, y, undefined, 1000)` with `calibratePoint(x, y, { captureMs: 1000 })`.
  - `catchUp(options?)` takes camelCase options, like the rest of the extension's methods: `maxWaitMs` (was `max_wait_ms`) and `saveUnprocessedCrops` (was `save_unprocessed_crops`). The `saccade-catch-up` plugin's own parameters, `max_wait` and `save_unprocessed_crops`, are unchanged.

### Patch Changes

- [#21](https://github.com/jspsych/saccadejs/pull/21) [`b37a238`](https://github.com/jspsych/saccadejs/commit/b37a23801033c5395f41b3fc1834efe5b65f7695) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - The time-sync verdict now requires a peak edge statistic (`peakD` / `peak_d`) of at least 0.6, up from 0.5. In bench tests against a photodiode, a 15 s run in bright light at 15 fps, where the screen barely changed the camera image, passed as `"OK"` at D = 0.52 with a delay off by more than 400 ms. No correct run in those tests fell between 0.5 and 0.6.

## 0.2.0

### Minor Changes

- [#4](https://github.com/jspsych/saccadejs/pull/4) [`40dc478`](https://github.com/jspsych/saccadejs/commit/40dc47836a8f1bc4600abc7314a2b70d46366d39) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - - `median_error_viewport` is now the error as a fraction of the viewport's diagonal, instead of x/width and y/height combined. The same pixel error no longer counts for more in the viewport's shorter direction, and on a 16:9 viewport the value is in the unit the model's held-out error is reported in.
  - `lambdaFor` is now given the number of distinct calibration targets rather than rows, so nine dots shown twice still get the nine-point penalty. `fitCalibration()`'s `nPoints` counts distinct targets too, and the new `countTargets()` helper does the counting.
  - The time-sync trial applies the measured lag only when the verdict is `OK`. Any other verdict is recorded with `applied: false`.
  - Corrected the time-sync flash-rate wording: at most two changes, or one flash, per second.
