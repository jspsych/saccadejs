---
id: browser-compatibility
title: Browser compatibility
sidebar_label: Browser compatibility
description: The browser features saccade.js depends on, which browsers have them, and what degrades when one is missing.
---

# Browser compatibility

The docs recommend Chrome or Edge. Nothing in saccade.js checks the user agent or refuses to
run elsewhere: every browser that can open a camera will produce gaze estimates. What differs
between browsers is frame rate and the quality of the timestamps, and both degrade quietly.
This page says what the library actually asks the browser for, so you can decide for yourself.

## What saccade.js needs

| Feature | What uses it | Without it |
| --- | --- | --- |
| `getUserMedia` over a secure context | Everything | Nothing runs |
| `requestVideoFrameCallback` | The frame loop, and every sample timestamp | Falls back to `requestAnimationFrame`; timestamps become processing times |
| `captureTime` in the rVFC metadata | `saccade-time-sync`, and the `t` in `saccade_data` | The lag measurement is not a real measurement |
| WebGPU | The eye model, through onnxruntime-web | Runs on WebAssembly at a fraction of the frame rate |
| WebGL 2 | MediaPipe's face landmarker (GPU delegate) | Falls back to the CPU delegate, more slowly |
| WebAssembly | Both runtimes | Nothing runs |

`getUserMedia`, WebGL 2 and WebAssembly are in every current browser and are not worth
worrying about. The other three are the interesting ones.

## Camera frame callbacks

`requestVideoFrameCallback` is what lets the tracker run once per camera frame rather than once
per display refresh, and it is what carries the frame's timestamps.

| Browser | Version |
| --- | --- |
| Chrome, Edge | 83 |
| Safari | 15.4 |
| Firefox | 132 |

It has been [Baseline](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
since October 2024, so this is no longer a real dividing line between browsers. Without it the
pipeline falls back to a plain `requestAnimationFrame` tick, records `time.source` as
`"callback"`, and stamps each sample with `performance.now()` at the moment the model finished
— which is neither when the frame was captured nor when the light left the screen.

## Capture timestamps

`captureTime` is optional in the spec, present "for WebRTC or getUserMedia applications and
absent otherwise". All three engines populate it for a camera stream, but they do not all mean
the same thing by it, and no compatibility table records the difference:

- **Chromium** maps the frame to the capture pipeline's reference clock, which tracks the
  camera's own timestamps.
- **Firefox** (132+) uses the camera pipeline's timestamp when there is one, falling back to a
  conversion from the WebRTC clock. See
  [`HTMLVideoElement.cpp`](https://searchfox.org/mozilla-central/source/dom/media/mediaelement/HTMLVideoElement.cpp).
- **WebKit** stamps it with `MonotonicTime::now()` at the moment the frame reaches the capture
  source. See
  [`AVVideoCaptureSource.mm`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/mediastream/cocoa/AVVideoCaptureSource.mm).
  That is an arrival time, not an exposure time.

This matters less than it sounds. `saccade-time-sync` measures the round trip empirically —
screen flash to camera frame — so whatever the browser folds into `captureTime` is measured
along with the display and camera latency and subtracted with them. A browser that stamps
arrival rather than exposure produces a larger `lag_ms`, not a wrong one. What would break the
correction is *jitter*, and the trial already reports that: a wide `plateau_width_ms` or
`halves_ms` far apart is an `UNRELIABLE` verdict regardless of browser.

The failure worth guarding against is not a browser stamping the clock differently. It is a
browser supplying no `captureTime` at all, which shows up as `clock: "callback"`.

## WebGPU

This is the real difference between browsers today. The eye model runs through onnxruntime-web,
which tries WebGPU and falls back to WebAssembly (`executionProviders`, default
`["webgpu", "wasm"]`). The WASM path works, but slowly enough that a study with a frame-rate
threshold will exclude the participant.

| Browser | WebGPU |
| --- | --- |
| Chrome, Edge 113+ | Everywhere |
| Safari 26+ | macOS 26 and iOS 26 |
| Firefox 141+ | Windows only. macOS on Apple Silicon from 145; Linux, Android and Intel Macs still in progress |

So a Firefox participant on macOS or Linux, or on a Firefox older than 141, gets the WebAssembly
backend. Note also that onnxruntime-web's WebGPU provider is developed and tested against
Chromium; having `navigator.gpu` is necessary but not a guarantee.

## Checking rather than assuming

Every run tells you what it got. Read it from the data instead of from the user agent:

| Where | Field | Watch for |
| --- | --- | --- |
| [`saccade-preview`](../reference/plugin-preview) | `backend` | `"wasm"` |
| [`saccade-performance`](../reference/plugin-performance) | `fps_median`, `backend` | a low rate, whatever the browser |
| Any trial's `saccade_timing` | `clock` | `"callback"` |
| [`saccade-time-sync`](../reference/plugin-time-sync) | `verdict`, `clock_source` | `"UNRELIABLE"`, `"callback"` |

A frame-rate threshold on `saccade-performance` is a better inclusion criterion than a browser
check, because it catches the thing you actually care about: a slow machine in Chrome fails a
study that a fast machine in Firefox would pass. The
[timing guide](timing-and-synchrony#suggested-exclusion-criteria) has a criterion covering the
clock and the frame rate together.

## Why the docs still say Chrome or Edge

Because it is the tested configuration, not because the other browsers lack a capability. On
the features above, Firefox and Safari now have everything the library asks for; what they do
not have is a run against a real webcam with the results checked. Until that exists, treat
Firefox and Safari as untested rather than unsupported, and if you collect data on one, look at
`backend`, `clock` and `fps_median` before you trust the timestamps.
