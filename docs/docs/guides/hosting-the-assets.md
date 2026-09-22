---
id: hosting-the-assets
title: Hosting the assets
sidebar_label: Hosting the assets
description: What saccade.js downloads at run time, and how to serve it yourself.
---

# Hosting the assets

When a participant starts your experiment, their browser downloads four sets of files that
saccade.js needs: the eye model and the software that runs it, plus Google's face finder and the
software that runs that. It adds up to about 25 MB on a first visit. After that the browser keeps
a copy.

By default these files come from public servers (content delivery networks, or CDNs). That is fine
for trying things out and for pilots. For real data collection, serve them from your own server
instead. Then an outage at a public server, or a file being removed from it, cannot stop your
study partway through collection.

## What gets downloaded

| File | Size | Where it comes from by default | Setting to change it |
| --- | --- | --- | --- |
| `eye_embedding.onnx`, the eye model | ~20 MB | Bundled with your experiment if you use npm and a bundler; otherwise the jsDelivr CDN | `modelUrl` |
| onnxruntime-web, which runs the eye model (`.wasm` and `.mjs` files) | a few MB | jsDelivr | `ortWasmUrl` (a folder) |
| MediaPipe, which runs the face finder (`.wasm` files) | ~3 MB | jsDelivr | `mediapipeWasmUrl` (a folder) |
| `face_landmarker.task`, the face finder model | ~3 MB | Google's servers | `faceLandmarkerUrl` |

## Serving the files yourself

This takes two steps: copy the files into your experiment's folder, then tell saccade.js where
they are.

**1. Copy the files.** The example below assumes your experiment is served from a folder called
`public`. Run these commands in your project folder (you need [Node.js](https://nodejs.org)
installed for `npm`):

```sh
npm install @saccadejs/core
mkdir -p public/assets/ort public/assets/mediapipe

# The eye model
cp node_modules/@saccadejs/core/models/eye_embedding.onnx public/assets/
# The software that runs it
cp node_modules/onnxruntime-web/dist/*.wasm node_modules/onnxruntime-web/dist/*.mjs public/assets/ort/
# The software that runs the face finder
cp -r node_modules/@mediapipe/tasks-vision/wasm public/assets/mediapipe/
# The face finder model
curl -o public/assets/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
```

**2. Point saccade.js at them.** Pass the locations when you register the extension:

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

If you are using the core library without jsPsych, pass the same `assets` object to the tracker:

```js
const tracker = new SaccadeTracker({ assets: { modelUrl: "/assets/eye_embedding.onnx" } });
```

Each setting is independent. You can host just the eye model yourself and leave the rest on the
CDN, for example.

**Watch out for folder URLs.** `ortWasmUrl` and `mediapipeWasmUrl` point to a _folder_, not a
file, because the software adds its own file names. If you get one wrong, the browser's error
will mention a file you never typed, such as a missing `.wasm` file. That is usually the first
sign.

**Two more settings you probably do not need.** `ortModuleUrl` and `mediapipeModuleUrl` exist for
experiments loaded with `<script>` tags, which have to load each piece of software from a URL.
`ortModuleUrl` defaults to the right file inside `ortWasmUrl`, so the example above does not need
either. If you use a bundler, both are ignored.

## Server settings

Most web servers handle these correctly already. If something does not load, check them:

- **Serve the page over HTTPS, or from `localhost`.** Browsers will not give a page access to the
  camera otherwise.
- **Serve `.wasm` files with the type `application/wasm`.** Some static hosting services guess
  the type from the file extension and get this one wrong. The `.onnx` and `.task` files are not
  fussy; `application/octet-stream` is fine for them.
- **Allow cross-origin requests if the files are on a different server from the experiment.**
  Serving everything from the same server avoids this whole category of problem. If you cannot,
  the file server needs to send the headers `Access-Control-Allow-Origin` and
  `Cross-Origin-Resource-Policy: cross-origin`.
- **Let browsers cache the files for a long time.** With the header
  `Cache-Control: public, max-age=31536000, immutable`, each participant downloads the model once,
  rather than every time the page loads.
- **Do not add `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy` headers.** These
  headers are what let a page run WebAssembly on several threads at once. saccade.js deliberately
  runs the model on a single thread, so it never needs them. They will not make it
  faster, and they can break other parts of your page.

## Checking that it works

1. Open the experiment in a private browser window, so nothing is already cached.
2. Open the browser's developer tools (F12, or right-click → Inspect) and go to the **Network**
   tab.
3. Run through the preview trial and check that:
   - every file loads with status `200`,
   - the `.wasm` files show `Content-Type: application/wasm`,
   - nothing is downloaded from a server you did not expect.

Finally, check the data from the [preview trial](../reference/plugin-preview). If `backend` is
`"wasm"` on a computer that should support WebGPU, a wrong asset URL is the first thing to check.
