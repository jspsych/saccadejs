---
id: plugin-performance
title: saccade-performance
sidebar_label: saccade-performance
description: Measure the tracker's effective frame rate, and exclude machines too slow for the study.
---

# `saccade-performance`

Measures how many gaze estimates per second the tracker actually produces on this participant's
computer, and, if you choose, ends the experiment for computers that are too slow.

Why this matters: on a computer or browser that cannot use the graphics card, saccade.js does not
stop or warn. It switches to a slower method and carries on, producing fewer gaze samples per
second. This trial is how you find out, with a number, before your data depends on it.

The trial asks the participant to look at a dot and hold still for about six seconds: one second
of warm-up, then five seconds of measurement.

```js
timeline.push({ type: jsPsychSaccadePerformance });
```

Put it after [`saccade-preview`](plugin-preview), which starts the camera, and before
[`saccade-calibrate`](plugin-calibrate), so a participant who is going to be turned away does not
first sit through calibration.

| | |
| --- | --- |
| Package | `@saccadejs/plugin-performance` |
| Browser global | `jsPsychSaccadePerformance` |
| Trial type | `saccade-performance` |
| Requires | the [extension](extension) and a running camera, so it comes after [`saccade-preview`](plugin-preview) |

## Parameters

Excluding participants works the same way as in jsPsych's
[`browser-check`](https://www.jspsych.org/latest/plugins/browser-check/) plugin: you write an
`inclusion_function` that looks at the measurements and returns `true` or `false`, and an
`exclusion_message` shown to anyone who is excluded. If you already screen participants by
browser or screen size, this is one more check written the same way.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `stimulus` | `string` | a dot to look at | What to show while measuring. The tracker only processes frames with a face in them, so the default asks the participant to look at a dot and hold still. |
| `measurement_duration` | `number` | `5000` | How long to measure, in ms, after the warm-up. |
| `warmup_duration` | `number` | `1000` | How long to wait before measuring, in ms. The first frames are slow while the graphics card compiles the model and the camera adjusts its exposure, and would make the result look worse than it is. |
| `inclusion_function` | `(data) => boolean` | `() => true` | Receives the measurements (the fields under [Data](#data)); return `true` to keep this participant. The default keeps everyone. |
| `exclusion_message` | `(data) => string` | a generic message | Receives the measurements; returns the HTML to show when `inclusion_function` returns `false`. |

## Data

| Field | Type | Description |
| --- | --- | --- |
| `fps_median` | `number` | **The main result:** the typical number of gaze estimates per second (the median rate). `null` if it could not be measured, because a face was never in view for two frames in a row. |
| `fps_mean` | `number` | The average number of estimates per second over the whole measurement. |
| `fps_p10` | `number` | The rate at the slow end: one frame in ten was slower than this (the 10th percentile rate). See [below](#fps_p10-catches-what-the-median-hides). |
| `frames` | `number` | How many frames had a face in them. The rates are calculated from these. |
| `frames_without_face` | `number` | How many frames had no face in them. |
| `dropped` | `number` | Camera frames that arrived but were never processed because the tracker was still busy. Shows how far behind the camera the tracker fell. |
| `embed_ms_median` | `number` | The typical time the eye model took per frame, in ms. |
| `backend` | `"webgpu" \| "wasm"` | Whether the model ran on the graphics card (`"webgpu"`) or the slower processor path (`"wasm"`). |
| `rt` | `number` | Milliseconds from the start of the trial to the end of the measurement. |

## Example

```js
// A placeholder. Choose your own threshold from pilot data before collecting.
const minFps = 15;

timeline.push({
  type: jsPsychSaccadePerformance,
  inclusion_function: (data) => data.fps_median >= minFps,
  exclusion_message: (data) =>
    data.backend === "wasm"
      ? `<p>This browser could not use your graphics card for the eye tracker, so it runs too
         slowly for this study. Chrome or Edge on a desktop or laptop usually can.</p>`
      : `<p>The eye tracker runs too slowly on this computer for this study. Thank you for your
         time.</p>`,
});
```

**While piloting**, leave `inclusion_function` out, so nobody is excluded. Then look at
`fps_median` across your pilot participants to decide what threshold your study needs.

**To send slow computers down a different path** instead of ending the experiment, also leave
`inclusion_function` out and use a conditional timeline:

```js
const shortVersion = {
  timeline: [/* ... */],
  conditional_function: () => {
    const last = jsPsych.data
      .get()
      .filter({ trial_type: "saccade-performance" })
      .last(1)
      .values()[0];
    return last.fps_median < minFps;
  },
};
```

## Understanding the numbers

### Use `fps_median` for your threshold

It is the rate your experiment will actually run at, and the rate at which gaze samples will
appear in your data. saccade.js processes one camera frame at a time and does not ask for the
next until the current one is finished. So the rate is set by whichever is slower: the camera
delivering frames, or the computer processing them.

### Choose the threshold from your own design

There is no recommended threshold. How many samples per second a study needs depends on what it
measures, and this has not been studied for saccade.js. Pilot without excluding anyone, then
choose a threshold from what you see.

One limit holds whatever the design: at _f_ samples per second, you cannot place an eye movement
in time more precisely than about `1000 / f` ms. At 15 per second, that is about 67 ms; at 30,
about 33 ms. Other sources of error come on top of this. If your design depends on _when_ someone
looked, also read [Timing and synchrony](../guides/timing-and-synchrony).

### `fps_p10` catches what the median hides

Some computers run well most of the time but stall now and then, for example when they get hot
and slow themselves down, or when another program wakes up. Such a computer can have a healthy
median while a fifth of its samples arrive far too late. `fps_p10` is the rate that one frame in
ten falls below, so it drops only when slow frames make up at least a tenth of the measurement. A
single short hiccup will not move it.

### `embed_ms_median` tells you what is slow

If `fps_median` is low but `embed_ms_median` is small, the model is fast and the camera is simply
not delivering frames any quicker. A faster graphics card would not help. If `embed_ms_median` is
large, the model is the bottleneck; check whether `backend` is `"wasm"`.

If `backend` is `"wasm"` on a computer that should support WebGPU, one possible cause is a wrong
asset URL. See [Hosting the assets](../guides/hosting-the-assets).

### When the measurement fails

If the rate could not be measured, `fps_median` is `null`. In JavaScript, `null >= 15` is
`false`, so the `inclusion_function` above excludes that participant automatically. That is
deliberate: a participant whose frame rate is unknown has not passed the check.

### Frames with no face do not count

A frame with no face in it never reaches the eye model, so it takes almost no time to process.
Counting those frames would report a rate the computer cannot keep up once it is actually
tracking a face. They are reported separately as `frames_without_face`. A large number there means
the participant was out of view for part of the measurement, so the result is based on less time
than it seems.
