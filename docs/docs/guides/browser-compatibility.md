---
id: browser-compatibility
title: Browser compatibility
sidebar_label: Browser compatibility
description: The browser features saccade.js depends on, which browsers have them, and what degrades when one is missing.
---

# Browser compatibility

## The short answer

- **Chrome and Edge** are the tested browsers. Use them if you can.
- **Firefox and Safari** will run saccade.js, and recent versions have every feature it uses. They
  have not yet been tested with a real webcam and checked against known results, so treat them as
  _untested_ rather than unsupported.
- saccade.js never checks which browser it is running in and never refuses to run. In a weaker
  browser it runs more slowly or with less precise timestamps, **without any warning**. So rather
  than trusting the browser name, check the data each participant produces. The last section of
  this page shows how.

The rest of this page explains what saccade.js needs from a browser, and what happens when a
feature is missing.

## What saccade.js needs

| Feature | What it is for | If the browser lacks it |
| --- | --- | --- |
| Camera access (`getUserMedia`) on a secure page | Everything | Nothing works |
| WebAssembly | Running the face finder and the eye model | Nothing works |
| WebGL 2 | Running the face finder on the graphics card | The face finder runs on the processor instead, more slowly |
| WebGPU | Running the eye model on the graphics card | The eye model runs on the processor instead, much more slowly |
| Camera frame callbacks (`requestVideoFrameCallback`) | Processing each camera frame as it arrives, and knowing when it arrived | Frames are timestamped when processing finishes, not when they were captured |
| Capture timestamps (`captureTime`) | Knowing when each frame was captured, which the timing correction relies on | The timing correction is not a real measurement |

Every current browser has camera access, WebAssembly and WebGL 2, so those three are not worth
worrying about. The other three are covered below, most important first.

## WebGPU: the difference that matters most

WebGPU lets a web page use the computer's graphics card for heavy calculations. saccade.js tries
to run the eye model with WebGPU first. If it is not available, it quietly uses WebAssembly
instead, which runs on the main processor. That works, but more slowly, so the participant's
computer produces fewer gaze estimates per second. How much slower depends on the computer; the
[`saccade-performance`](../reference/plugin-performance) trial measures it.

| Browser | WebGPU available |
| --- | --- |
| Chrome, Edge 113+ | On all platforms |
| Safari 26+ | On macOS 26 and iOS 26 |
| Firefox 141+ | On Windows. On Apple Silicon Macs from Firefox 145. Not yet on Linux, Android, or Intel Macs |

So a participant using Firefox on Linux, or any Firefox older than 141, will run on the slower
path. Also note that the library saccade.js uses to run the model (onnxruntime-web) is developed
and tested mainly on Chrome. A browser having WebGPU does not guarantee the model will use it.

## Camera frame callbacks

The camera frame callback (`requestVideoFrameCallback`) tells saccade.js each time the camera
delivers a new frame, and when. It has been available in all major browsers since October 2024
([Baseline](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)):

| Browser | Available from |
| --- | --- |
| Chrome, Edge | 83 |
| Safari | 15.4 |
| Firefox | 132 |

In an older browser without it, saccade.js checks for new frames once per screen refresh instead,
and stamps each gaze sample with the time processing _finished_. That is later than when the
frame was captured, and later than when the screen changed. The data records this as `clock:
"callback"`.

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
lag will simply be larger.

What _would_ break the correction is a delay that keeps changing, and the time-sync trial already
catches that: it reports an `UNRELIABLE` verdict, whatever the browser. The case to watch for is
a browser that provides no capture timestamp at all, which shows up in the data as
`clock: "callback"`.

## Check the data, not the browser name

Every run records what it actually got. These are the fields to look at:

| Trial | Field | Warning sign |
| --- | --- | --- |
| [`saccade-preview`](../reference/plugin-preview) | `backend` | `"wasm"`: the model ran on the slower path |
| [`saccade-performance`](../reference/plugin-performance) | `fps_median` | A low number, whatever the browser |
| Any trial that records gaze | `saccade_timing.clock` | `"callback"`: no real capture times |
| [`saccade-time-sync`](../reference/plugin-time-sync) | `verdict`, `clock_source` | `"UNRELIABLE"`, `"callback"` |

For deciding who takes part, a minimum frame rate in `saccade-performance` works better than a
browser check, because it tests what you actually care about. A slow laptop running Chrome can be
too slow for your study while a fast desktop running Firefox is fine. The
[timing guide](timing-and-synchrony#deciding-which-trials-to-exclude) shows an exclusion rule
that checks the timing and the frame rate together.

If you do collect data in Firefox or Safari, look at `backend`, `clock` and `fps_median` before
you rely on the timestamps.
