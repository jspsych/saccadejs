---
"@saccadejs/core": major
"@saccadejs/extension": major
"@saccadejs/plugin-calibrate": major
"@saccadejs/plugin-catch-up": major
"@saccadejs/plugin-performance": major
"@saccadejs/plugin-preview": major
"@saccadejs/plugin-time-sync": major
"@saccadejs/plugin-validate": major
---

SaccadeJS 1.0. The packages now follow semantic versioning: a breaking change to any of them means a new major version.

Every package now requires the 1.x versions of the others. The extension and `saccade-time-sync` take `@saccadejs/core` `^1.0.0` (previously any version), and every plugin takes `@saccadejs/extension` `^1.0.0` (previously `>=0.1.0`, or `>=0.4.0` for `saccade-catch-up`).

Two extension methods changed:

- `calibratePoint(x, y, options?)` takes an options object in place of its three optional positional arguments: `calibratePoint(x, y, { embeddings, captureMs, timeoutMs })`. Replace `calibratePoint(x, y, undefined, 1000)` with `calibratePoint(x, y, { captureMs: 1000 })`.
- `catchUp(options?)` takes camelCase options, like the rest of the extension's methods: `maxWaitMs` (was `max_wait_ms`) and `saveUnprocessedCrops` (was `save_unprocessed_crops`). The `saccade-catch-up` plugin's own parameters, `max_wait` and `save_unprocessed_crops`, are unchanged.
