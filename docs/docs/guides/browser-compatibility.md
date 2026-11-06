---
id: browser-compatibility
title: Browser compatibility
sidebar_label: Browser compatibility
description: The browser features SaccadeJS depends on, which browsers have them, and what degrades when one is missing.
---

# Browser compatibility

## The short answer

- **Chrome and Edge** are the tested browsers. Use them if you can.
- **Firefox and Safari** will run SaccadeJS, and recent versions have every feature it uses. They
  have not yet been tested with a real webcam and checked against known results, so treat them as
  _untested_ rather than unsupported.
- SaccadeJS does not check which browser it is in. The one feature it refuses to run without is
  WebGL (see below). Any other missing feature makes it slower or its timestamps less precise,
  and **it does not warn you** when that happens. So check the data each participant produces
  rather than their browser name. The last section of this page shows how.

## What SaccadeJS needs

| Feature | What it is for | If the browser lacks it |
| --- | --- | --- |
| Camera access (`getUserMedia`) on a secure page | Everything | Nothing works |
| WebAssembly | Running the face finder and the eye model | Nothing works |
| WebGL | Reading camera frames into the face finder, and running it on the graphics card | With WebGL 1 or software WebGL, the face finder runs on the processor, more slowly. With no WebGL at all, nothing works, and the tracker stops with a `WebGLUnavailableError` |
| WebGPU | Running the eye model on the graphics card | The eye model runs on the processor instead, much more slowly. With `mode: "auto"`, SaccadeJS switches to [deferred mode](deferred-mode) |
| Camera frame callbacks (`requestVideoFrameCallback`) | Processing each camera frame as it arrives, and knowing when it arrived | Frames are timestamped at the next screen refresh, not when they were captured |
| Capture timestamps (`captureTime`) | Knowing when each frame was captured, which the timing correction relies on | Frames are stamped when they arrive (`receiveTime`), which the timing correction still accounts for. With neither timestamp, frames are stamped at the next screen refresh, and the timing correction is no longer a real measurement |

Every current browser has camera access, WebAssembly and WebGL. WebGL can be switched off,
though. If a participant has turned off hardware acceleration in their browser's settings, or the
browser has blocked their graphics card, the page gets no WebGL at all, and recent versions of
Chrome no longer fall back to a software version.

The face finder needs WebGL even when it runs on the processor, because it uses WebGL to read each
camera frame. So SaccadeJS checks for WebGL before downloading anything, and if it is missing,
stops with a `WebGLUnavailableError`. The preview trial tells the participant what went wrong. To
screen these participants out before you ask for the camera, call `webglAvailable()` from the
[core API](../reference/core-api#lower-level-exports).

## WebGPU: the difference that matters most

WebGPU lets a web page use the computer's graphics card for heavy calculations. SaccadeJS tries
to run the eye model with WebGPU first. If WebGPU is not available, it quietly falls back to
WebAssembly, which runs on the main processor and is slower. What that costs you depends on the
extension's `mode` setting:

- With `mode: "live"` (the default), the participant's computer produces fewer gaze estimates per
  second. How much slower depends on the computer; the
  [`saccade-performance`](../reference/plugin-performance) trial measures it.
- With `mode: "auto"`, a computer without WebGPU runs in [deferred mode](deferred-mode): gaze
  keeps the camera's full rate, but arrives after the trial instead of during it, and nothing
  gaze-contingent works.

| Browser | WebGPU available |
| --- | --- |
| Chrome, Edge | On Windows, macOS and ChromeOS from 113. On Android from 121. On Linux, depending on the version and graphics card |
| Safari 26+ | On macOS 26 and iOS 26 |
| Firefox 141+ | On Windows. On Apple Silicon Macs from Firefox 145. Not yet on Linux, Android, or Intel Macs |

So a participant using Firefox on Linux, or any Firefox older than 141, runs on the slower path.
Even a browser with WebGPU may not run the model on it, because onnxruntime-web, the library that
runs the model, is developed and tested mainly on Chrome.

## Camera frame callbacks

The camera frame callback (`requestVideoFrameCallback`) tells SaccadeJS each time the camera
delivers a new frame, and when. It has been available in all major browsers since October 2024
([Baseline](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)):

| Browser | Available from |
| --- | --- |
| Chrome, Edge | 83 |
| Safari | 15.4 |
| Firefox | 132 |

In an older browser without it, SaccadeJS processes whatever frame the video is showing once per
screen refresh instead, and stamps each gaze sample with the time of that refresh. That is later
than when the frame was captured, and the same frame can be processed twice. The data records this
as `clock: "callback"`.

## Capture timestamps

Along with each frame, browsers can report when the camera captured it (`captureTime`). All three
major browser engines provide this for webcams, but they do not measure quite the same thing:

- **Chrome and Edge** use the camera's own timestamps.
- **Firefox** (132+) uses the camera's timestamp when there is one, and otherwise converts one
  from another clock. See
  [`HTMLVideoElement.cpp`](https://searchfox.org/mozilla-central/source/dom/media/mediaelement/HTMLVideoElement.cpp).
- **Safari** stamps the moment the frame _arrives_ from the camera, which is somewhat after it
  was captured. See
  [`AVVideoCaptureSource.mm`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/mediastream/cocoa/AVVideoCaptureSource.mm).

This matters less than it sounds. The [`saccade-time-sync`](../reference/plugin-time-sync) trial
does not rely on what the browser claims. It measures the whole delay directly, from a change on
the screen to that change showing up in a camera frame. Whatever the browser adds to the
timestamp is measured along with everything else and subtracted with it. In Safari the measured
lag will be larger. A browser that reports only when the frame arrived records `clock:
"receiveTime"`, which the time-sync measurement corrects in the same way.

A delay that keeps changing would break the correction, but the time-sync trial catches that and
reports an `UNRELIABLE` verdict, whatever the browser. The case to watch for is
a browser that provides no capture timestamp at all, which shows up in the data as
`clock: "callback"`.

## Check the data, not the browser name

Every run records what the browser gave it. These are the fields to look at:

| Trial | Field | Warning sign |
| --- | --- | --- |
| [`saccade-preview`](../reference/plugin-preview) | `backend` | `"wasm"`: the model ran on the slower path |
| Any trial | `saccade_mode` | `"deferred"`: gaze was computed after the trial, not during it |
| [`saccade-performance`](../reference/plugin-performance) | `fps_median` | A low number, whatever the browser |
| Any trial that records gaze | `saccade_timing.clock` | `"callback"`: no real capture times |
| [`saccade-time-sync`](../reference/plugin-time-sync) | `verdict`, `clock_source` | `"UNRELIABLE"`, `"callback"` |

To decide who takes part, a minimum frame rate in `saccade-performance` works better than a
browser check, because it tests what you care about. A slow laptop running Chrome can be too slow
for your study while a fast desktop running Firefox is fine. This holds in live mode only. In
deferred mode the frame loop does not run the model, so the frame rate looks healthy on the very
computers that were too slow for live mode. See
[the performance trial in deferred mode](../reference/plugin-performance#in-deferred-mode). The
[timing guide](timing-and-synchrony#deciding-which-trials-to-exclude) shows an exclusion rule
that checks the timing and the frame rate together.

If you do collect data in Firefox or Safari, look at `backend`, `saccade_mode`, `clock` and
`fps_median` before you rely on the timestamps.
