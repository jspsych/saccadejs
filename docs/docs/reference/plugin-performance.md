---
id: plugin-performance
title: saccade-performance
sidebar_label: saccade-performance
description: Measure the tracker's effective frame rate, and exclude machines too slow for the study.
---

# `saccade-performance`

Measures how fast the tracker actually runs on this participant's machine, and optionally ends
the experiment for machines that are too slow. Without WebGPU saccade.js falls back to
WebAssembly and keeps going, more slowly, without saying anything; this is how you find out in
numbers, before your data depends on it.

The exclusion machinery is
[`browser-check`](https://www.jspsych.org/latest/plugins/browser-check/)'s — an
`inclusion_function` over the measured data and an `exclusion_message` built from the same data —
so a study that already gates on browser and screen size gains one more gate written the same
way.

|                |                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Package        | `@saccadejs/plugin-performance`                                                                         |
| Browser global | `jsPsychSaccadePerformance`                                                                             |
| Trial type     | `saccade-performance`                                                                                   |
| Requires       | the [extension](extension) and a running tracker, so it comes after [`saccade-preview`](plugin-preview) |

```js
timeline.push({ type: jsPsychSaccadePerformance });
```

Put it before [`saccade-calibrate`](plugin-calibrate), so a participant who is going to be
excluded is not first made to sit through thirteen calibration points.

## Parameters

| Parameter              | Type                | Default           | Description                                                                                                                                                 |
| ---------------------- | ------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stimulus`             | `string`            | a fixation dot    | What to show while measuring. A face has to be in view for a frame to reach the model, so the default asks the participant to look at a dot and hold still. |
| `measurement_duration` | `number`            | `5000`            | How long to measure for in ms, once the warm-up has passed.                                                                                                 |
| `warmup_duration`      | `number`            | `1000`            | How long to discard in ms before measuring. The first frames pay for shader compilation, the first WebGPU submit and the camera's exposure ramp.            |
| `inclusion_function`   | `(data) => boolean` | `() => true`      | Receives the measured data; return `true` to include this participant. The default excludes nobody.                                                         |
| `exclusion_message`    | `(data) => string`  | a generic message | Receives the measured data; returns the HTML shown when `inclusion_function` returns `false`.                                                               |

## Data

| Field                 | Type                 | Description                                                                                                                           |
| --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `fps_median`          | `number`             | Median frame rate over the window, in Hz. **The headline number.** `null` if no two consecutive frames with a face in them were seen. |
| `fps_mean`            | `number`             | Frames per second averaged over the whole window.                                                                                     |
| `fps_p10`             | `number`             | The rate at the slow end: the 10th percentile of frame rate, i.e. the 90th percentile of the interval between frames.                 |
| `frames`              | `number`             | Frames with a face in them — the frames the rates are computed from.                                                                  |
| `frames_without_face` | `number`             | Frames in the window with no face in them.                                                                                            |
| `dropped`             | `number`             | Camera frames presented but never processed, from `requestVideoFrameCallback`. How far behind the camera the tracker fell.            |
| `embed_ms_median`     | `number`             | Median time in ms spent in the model for one frame.                                                                                   |
| `backend`             | `"webgpu" \| "wasm"` | The execution provider the model is running on.                                                                                       |
| `rt`                  | `number`             | Milliseconds from trial start to the end of the measurement.                                                                          |

## Example

```js
timeline.push({
  type: jsPsychSaccadePerformance,
  inclusion_function: (data) => data.fps_median >= 15,
  exclusion_message: (data) =>
    data.backend === "wasm"
      ? `<p>This browser could not use your graphics card for the eye tracker, so it runs too
         slowly for this study. Chrome or Edge on a desktop or laptop usually can.</p>`
      : `<p>The eye tracker runs too slowly on this computer for this study. Thank you for your
         time.</p>`,
});
```

To measure without excluding anyone — the right thing to do while piloting — leave
`inclusion_function` out and read `fps_median` off the pilot data before deciding what threshold
it justifies.

To keep the participant in the experiment but route them somewhere else, leave
`inclusion_function` out too and branch on the data yourself:

```js
const shortVersion = {
  timeline: [/* ... */],
  conditional_function: () => {
    const last = jsPsych.data
      .get()
      .filter({ trial_type: "saccade-performance" })
      .last(1)
      .values()[0];
    return last.fps_median < 15;
  },
};
```

## Interpreting the numbers

### `fps_median` is what to gate on

It is the rate the experiment will actually run at. saccade.js keeps exactly one inference in
flight and asks for the next camera frame only after the current one has been through the model,
so the loop rate is bounded by whichever of camera delivery or inference is slower — and it is
also the rate at which gaze samples land in your data.

### Pick the threshold from your design

There is no default threshold because there is no design-independent answer.

| If the measure is                                                            | Then                                                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| where someone looked, over seconds — preference, dwell time, AOI proportions | A few frames per second is enough.                                                      |
| how long someone looked, over hundreds of ms                                 | 10–15 fps is a reasonable floor.                                                        |
| _when_ someone looked — saccade latency, time-locking to onset               | 30 fps at least, and read [Timing and synchrony](../guides/timing-and-synchrony) first. |
| gaze-contingent display changes                                              | 30 fps at least, and the pipeline latency matters as much as the rate.                  |

Sampling at _f_ Hz puts a floor of roughly `1000 / f` ms on how precisely any event can be placed
in time, before any of the other error sources.

### `fps_p10` catches what the median hides

A machine that stalls periodically — thermal throttling, a busy background tab, another program
waking up — can have a perfectly healthy median while a fifth of its samples arrive far too late.
The p10 only moves when the slow frames are at least a tenth of them, so an isolated hiccup will
not fail anybody.

### `embed_ms_median` says whose fault a low rate is

A low `fps_median` with a small `embed_ms_median` is a camera that is not delivering frames any
faster, and no amount of GPU will change it. A large `embed_ms_median` is the model, and usually
means `backend` is `"wasm"`.

`backend: "wasm"` on a machine that should have WebGPU usually means an asset URL is wrong rather
than a machine that cannot do it — see [Hosting the assets](../guides/hosting-the-assets).

### A machine that could not be measured

`fps_median` is `null`, and `null >= 15` is `false`, so the obvious comparison in an
`inclusion_function` excludes it without any extra work. That is the right default: a participant
whose frame rate is unknown is not one who passed.

### Frames with no face in them do not count

They never reach the model at all — no face, no eye crop, no inference — so counting them would
report a rate the machine cannot sustain once it is actually tracking. They are reported
separately as `frames_without_face`. A large number there means the participant was out of frame,
and the measurement covers less time than it looks.
