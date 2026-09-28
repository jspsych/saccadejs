---
"@saccadejs/core": minor
"@saccadejs/plugin-preview": patch
---

Fail fast when the browser has no WebGL. MediaPipe's face landmarker needs WebGL even with its CPU delegate, because it reads every camera frame through a WebGL texture. Without WebGL it built and then threw on every frame, so the tracker never found a face and gave no reason. `createLandmarker()`, and so `tracker.init()`, now checks first and throws a `WebGLUnavailableError` before downloading MediaPipe. `webglAvailable()` is exported so an experiment can screen for it up front. The preview trial shows participants a message about the browser's graphics settings for this error, instead of suggesting a camera-permission problem. The browser-compatibility guide no longer says the face finder works without WebGL.
