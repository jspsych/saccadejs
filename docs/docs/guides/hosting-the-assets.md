---
id: hosting-the-assets
title: Hosting the assets
sidebar_label: Hosting the assets
description: What saccade.js downloads at run time, and how to serve it yourself.
---

# Hosting the assets

Four files reach the participant's browser at run time, about 25 MB in total on a first visit.
By default they come from a CDN, which is fine for a demo or a pilot. Self-host for real data
collection, so that a CDN outage or a yanked version cannot end a study mid-collection.

## What gets loaded

| Asset | Size | Default source | Option |
| --- | --- | --- | --- |
| `eye_embedding.onnx` | ~20 MB | Next to the package under a bundler; otherwise jsDelivr | `modelUrl` |
| onnxruntime-web `.wasm` / `.mjs` | a few MB fetched | jsDelivr | `ortWasmUrl` (a directory) |
| `@mediapipe/tasks-vision` WebAssembly | ~3 MB | jsDelivr | `mediapipeWasmUrl` (a directory) |
| `face_landmarker.task` | ~3 MB | Google's hosted model | `faceLandmarkerUrl` |

## Self-hosting

Copy the files:

```sh
npm install @saccadejs/core
mkdir -p public/assets/ort public/assets/mediapipe

cp node_modules/@saccadejs/core/models/eye_embedding.onnx public/assets/
cp node_modules/onnxruntime-web/dist/*.wasm node_modules/onnxruntime-web/dist/*.mjs public/assets/ort/
cp -r node_modules/@mediapipe/tasks-vision/wasm public/assets/mediapipe/
curl -o public/assets/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
```

Then point at them, through the extension:

```js
const jsPsych = initJsPsych({
  extensions: [
    {
      type: jsPsychExtensionSaccade,
      params: {
        assets: {
          modelUrl: "/assets/eye_embedding.onnx",
          ortWasmUrl: "/assets/ort/",
          mediapipeWasmUrl: "/assets/mediapipe/wasm",
          faceLandmarkerUrl: "/assets/face_landmarker.task",
        },
      },
    },
  ],
});
```

or directly on a tracker:

```js
const tracker = new SaccadeTracker({ assets: { modelUrl: "/assets/eye_embedding.onnx" } });
```

Every field is optional and independent, so you can override one and leave the rest on the CDN.

`ortWasmUrl` and `mediapipeWasmUrl` are **directory** URLs: the runtimes append their own
filenames. Getting them wrong produces a 404 for a file you never named, which is the usual
first symptom.

Two more fields, `ortModuleUrl` and `mediapipeModuleUrl`, exist for the script-tag build, which
cannot resolve a bare module specifier and has to import each runtime from a URL. `ortModuleUrl`
defaults to `ort.bundle.min.mjs` inside `ortWasmUrl`, so the recipe above needs neither. Under a
bundler both are ignored.

## Serving requirements

- **HTTPS, or `localhost`.** Browsers will not open a camera otherwise.
- **`.wasm` served as `application/wasm`.** Static hosts that guess by extension often get this
  wrong. `.onnx` and `.task` are fetched as `ArrayBuffer`, so `application/octet-stream` is fine.
- **CORS**, if the assets are on a different origin from the experiment. Serving them from the
  same origin removes a whole class of failure; if you cannot, set
  `Access-Control-Allow-Origin` and `Cross-Origin-Resource-Policy: cross-origin`.
- **Long cache lifetimes.** `Cache-Control: public, max-age=31536000, immutable` means the model
  is downloaded once per participant rather than once per page load.
- **Do not add COOP/COEP headers.** saccade.js runs the ONNX session single-threaded on purpose,
  so it never needs cross-origin isolation. Those headers will not make it faster and may break
  the rest of your page.

## Checking it works

Load the experiment in a private window, open the network panel, and confirm that every asset
returns 200, that `.wasm` carries `Content-Type: application/wasm`, and that nothing is fetched
from an origin you did not intend.

Then check the [preview trial](../reference/plugin-preview) data. If `backend` is `"wasm"` on a
machine that should have WebGPU, an asset URL is usually wrong.
