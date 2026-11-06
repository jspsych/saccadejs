---
id: hosting-the-assets
title: Hosting the assets
sidebar_label: Hosting the assets
description: What SaccadeJS downloads at run time, and how to serve it yourself.
---

# Hosting the assets

When a participant starts your experiment, their browser downloads four sets of files for
SaccadeJS: the eye model, the software that runs it, Google's face finder model, and the software
that runs that. Together they come to about 30 MB on the first visit, and the browser keeps a copy
after that.

By default these files come from public servers (content delivery networks, or CDNs). That is fine
for trying things out and for pilots. For real data collection, serve them from your own server,
so an outage at a public server, or a file removed from it, cannot stop your study partway
through.

## What gets downloaded

| File | Size | Where it comes from by default | Setting to change it |
| --- | --- | --- | --- |
| `eye_embedding.onnx`, the eye model | ~20 MB | The copy published with your version of `@saccadejs/core`: from the CDN that served the `<script>` tag (unpkg or jsDelivr), or from jsDelivr if you use a bundler. A bundler does not bundle the model. | `modelUrl` |
| onnxruntime-web, which runs the eye model (`.wasm` and `.mjs` files) | a few MB | jsDelivr | `ortWasmUrl` (a folder) |
| MediaPipe, which runs the face finder (`.wasm` files) | ~3 MB | jsDelivr | `mediapipeWasmUrl` (a folder) |
| `face_landmarker.task`, the face finder model | ~4 MB | Google's servers | `faceLandmarkerUrl` |

## Serving the files yourself

There are two steps: copy the files into your experiment's folder, then tell SaccadeJS where
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
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

The `curl` line uses the same versioned address SaccadeJS loads by default. Google also serves
the face finder at a `latest` address. Avoid that one, because Google could point it at a new
model at any time.

**2. Point SaccadeJS at them.** Pass the locations when you register the extension:

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

Each setting works on its own. For example, you can host just the eye model and leave the rest
on the CDN.

**Watch out for folder URLs.** `ortWasmUrl` and `mediapipeWasmUrl` point to a _folder_, not a
file, because the software adds its own file names. If one is wrong, the first sign is usually a
browser error about a file you never typed, such as a missing `.wasm` file.

**Two more settings you probably do not need.** `ortModuleUrl` and `mediapipeModuleUrl` exist for
experiments loaded with `<script>` tags, which have to load each piece of software from a URL.
`ortModuleUrl` defaults to the right file inside `ortWasmUrl`, so the example above does not need
either. If you use a bundler, `mediapipeModuleUrl` is ignored, but `ortModuleUrl` is still used by
the background threads of [deferred mode](deferred-mode#hosting), which cannot reach the bundled
copy.

## Server settings

Most web servers handle these correctly already. If something does not load, check them:

- **Serve the page over HTTPS, or from `localhost`.** Browsers will not give a page access to the
  camera otherwise.
- **Serve `.wasm` files with the type `application/wasm`.** Some static hosting services guess
  the type from the file extension and get this one wrong. The `.onnx` and `.task` files can be
  served as `application/octet-stream`.
- **Allow cross-origin requests if the files are on a different server from the experiment.**
  Serving everything from one server avoids the problem. If you cannot,
  the file server needs to send the headers `Access-Control-Allow-Origin` and
  `Cross-Origin-Resource-Policy: cross-origin`.
- **Let browsers cache the files for a long time.** With the header
  `Cache-Control: public, max-age=31536000, immutable`, each participant downloads the model once,
  rather than every time the page loads.
- **Do not add `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy` headers.** These
  headers are what let a page run WebAssembly on several threads at once. SaccadeJS runs each
  copy of the model on a single thread (in deferred mode, several copies in separate
  background threads), so it never needs them. They will not make it faster, and they can break
  other parts of your page.
- **If your page sets a Content-Security-Policy, allow `worker-src blob:`.** Deferred mode starts
  its background threads from `blob:` URLs.

## Checking that it works

1. Open the experiment in a private browser window, so nothing is already cached.
2. Open the browser's developer tools (F12, or right-click → Inspect) and go to the **Network**
   tab.
3. Run through the preview trial and check that:
   - every file loads with status `200`,
   - the `.wasm` files show `Content-Type: application/wasm`,
   - nothing is downloaded from a server you did not expect.

Finally, check the data from the [preview trial](../reference/plugin-preview). A wrong asset URL
usually stops the preview with an error rather than slowing it down. If `backend` is `"wasm"` on a
computer that should support WebGPU, the browser's WebGPU was unavailable. See
[Browser compatibility](browser-compatibility#webgpu-the-difference-that-matters-most).
