---
id: hosting-the-assets
title: Hosting the assets
sidebar_label: Hosting the assets
description: What saccade.js downloads at run time, where it comes from by default, and how to self-host it.
---

# Hosting the assets

saccade.js is not a self-contained script. Before it can produce a single gaze estimate, four
things have to reach the participant's browser. This page is what to check before you collect
data from strangers.

## What gets loaded

| Asset | Size | Default source | Option |
| --- | --- | --- | --- |
| `eye_embedding.onnx` — the eye-embedding model | ~20 MB | Resolved relative to the package by a bundler; otherwise `cdn.jsdelivr.net/npm/saccadejs@<version>/models/eye_embedding.onnx` | `assets.modelUrl` |
| onnxruntime-web `.wasm` / `.mjs` — the ONNX runtime | ~10–20 MB across variants, one or two actually fetched | jsDelivr, `onnxruntime-web@<pinned>/dist/` | `assets.ortWasmUrl` (a **directory** URL) |
| `@mediapipe/tasks-vision` WebAssembly | ~3 MB | jsDelivr, `tasks-vision@<pinned>/wasm` | `assets.mediapipeWasmUrl` (a **directory** URL) |
| `face_landmarker.task` — the MediaPipe face model | ~3 MB | Google's hosted float16 model | `assets.faceLandmarkerUrl` |

All four are set through one option:

```js
const tracker = new SaccadeTracker({
  assets: {
    modelUrl: "/assets/eye_embedding.onnx",
    ortWasmUrl: "/assets/ort/",
    mediapipeWasmUrl: "/assets/mediapipe/wasm",
    faceLandmarkerUrl: "/assets/face_landmarker.task",
  },
});
```

or, through the jsPsych extension:

```js
const jsPsych = initJsPsych({
  extensions: [
    { type: jsPsychExtensionSaccade, params: { assets: { modelUrl: "/assets/eye_embedding.onnx" } } },
  ],
});
```

Every field is optional and they are independent: override the model URL and leave the rest on
the CDN if that is all you need.

Two further fields exist for the `<script>`-tag build only. It cannot resolve a bare module
specifier, so it loads the two runtimes by `import()`ing a URL:

| Option | Default |
| --- | --- |
| `ortModuleUrl` | `ort.bundle.min.mjs` inside `ortWasmUrl` |
| `mediapipeModuleUrl` | the pinned jsDelivr bundle |

If you self-host onnxruntime-web by copying its whole `dist/` into one directory — which is
what the recipe below does — `ortModuleUrl` follows `ortWasmUrl` and you never set it. You need
it only when the ESM entry point is somewhere other than alongside the `.wasm` files. Under a
bundler both are ignored, because the bundler already resolved the packages.

## CDN or self-host?

**The CDN defaults are there so that a `<script>`-tag experiment works with no build step and no
server configuration.** They are the right choice for a demo, a pilot, or a classroom
exercise.

**Self-host for real data collection.** Four reasons:

1. **Version pinning that you control.** A CDN outage or a version yank mid-collection is a
   dead study. Files on your own server change when you change them.
2. **Reproducibility.** "The model was `eye_embedding.onnx`, sha256 `…`, served from our own
   host" is a statement you can make years later. A jsDelivr URL for a package version that has
   since been unpublished is not.
3. **Institutional and legal constraints.** Some ethics boards and some countries' data rules
   object to participants' browsers contacting third-party CDNs at all, even for static files.
4. **Reliability.** 20 MB from a CDN a participant's network happens to route badly is a slow
   or failed first load. Your own server, near your participants, is often faster.

The trade-off is that you are now responsible for the caching headers, and for re-copying the
files when you upgrade the package.

### Copying the files

The model ships inside the npm package:

```sh
npm install saccadejs
mkdir -p public/assets
cp node_modules/saccadejs/models/eye_embedding.onnx public/assets/

# onnxruntime-web wasm/mjs, all of it — the runtime picks the variant it needs at run time
mkdir -p public/assets/ort
cp node_modules/onnxruntime-web/dist/*.wasm node_modules/onnxruntime-web/dist/*.mjs public/assets/ort/

# MediaPipe wasm
mkdir -p public/assets/mediapipe
cp -r node_modules/@mediapipe/tasks-vision/wasm public/assets/mediapipe/

# the face landmarker model
curl -o public/assets/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
```

`ortWasmUrl` and `mediapipeWasmUrl` are **directory** URLs — the runtimes append their own
filenames — so they must end in a slash or name a directory that exists. Getting this wrong
produces a 404 for a file you never named, which is the usual first symptom.

This site does exactly this for its own [live demo](../demo): `docs/scripts/copy-model.mjs`
copies the model out of the package into `static/models/` at build time, and the component
passes `assets.modelUrl = useBaseUrl("/models/eye_embedding.onnx")`.

## Serving requirements

**HTTPS, or `localhost`.** `getUserMedia` refuses to run outside a secure context, so an
experiment served over plain `http://` from anything other than `localhost` cannot open a
camera at all.

**Correct MIME types.** `.wasm` must be served as `application/wasm` — some runtimes refuse to
compile it otherwise, and the streaming compile path always does. `.onnx` and `.task` are
fetched as `ArrayBuffer`, so `application/octet-stream` is fine. Static hosts that guess by
extension (S3, some university web servers) frequently get `.wasm` wrong.

**CORS, if the assets are on a different origin from the page.** Anything cross-origin needs
`Access-Control-Allow-Origin`. This bites in a specific and common configuration: the
experiment runs on a study-hosting platform (Prolific redirect target, Pavlovia, JATOS, your
lab's server) while the assets sit on a separate file host or bucket. Serve them from the same
origin as the experiment if you possibly can; it removes an entire class of failure. If you
cannot:

```
Access-Control-Allow-Origin: https://your-experiment-host.example
Cross-Origin-Resource-Policy: cross-origin
```

**Range requests, ideally.** A 20 MB model over a flaky connection resumes far better when the
server honours `Range`. Most do; `python -m http.server` does not.

**Long cache lifetimes on immutable files.** The model never changes for a given version:

```
Cache-Control: public, max-age=31536000, immutable
```

The browser then downloads it once per participant rather than once per page load, which
matters if your experiment reloads between blocks.

## Cross-origin isolation, and why you probably do not need it

onnxruntime-web can use multi-threaded WebAssembly, which requires `SharedArrayBuffer`, which
requires the page to be cross-origin isolated with `Cross-Origin-Opener-Policy: same-origin`
and `Cross-Origin-Embedder-Policy: require-corp`. Those headers break embedded content and are
awkward on most hosting platforms.

saccade.js sidesteps it: the ONNX session is created with `numThreads: 1`, so the
single-threaded runtime is used and no isolation headers are needed. On WebGPU the CPU thread
count is irrelevant anyway. **Do not add COOP/COEP headers for saccade.js** — they will not make
it faster and they may break the rest of your page.

## Bandwidth and the first load

Roughly **25–30 MB** on a first visit, dominated by the model. That is a real cost for
participants on metered or slow connections, and it is the single biggest practical difference
from WebGazer.

- Say so in your consent or instructions text, especially for mobile-recruited samples.
- Put the [preview trial](../reference/plugin-preview) early. It is where the download happens
  and where the plugin can show a progress line, rather than mid-experiment.
- The model is cached by the browser afterwards, so a returning participant or a page reload
  pays nothing.

## Checking it works

Load the experiment in a private window (no warm cache), open the network panel, and confirm:

- every asset returns **200**, not 404 or 403;
- `.wasm` responses carry `Content-Type: application/wasm`;
- nothing is being fetched from an origin you did not intend;
- the total transferred is what you expect.

Then check `saccade_timing.fps` and `backend` in the preview trial's data. If `backend` is
`"wasm"` on a machine that should have WebGPU, the runtime silently fell back — usually because
an asset URL was wrong.
