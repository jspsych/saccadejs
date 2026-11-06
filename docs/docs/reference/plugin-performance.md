---
id: plugin-performance
title: saccade-performance
sidebar_label: saccade-performance
description: Measure the tracker's effective frame rate, and exclude machines too slow for the study.
---

# `saccade-performance`

`saccade-performance` measures how many gaze estimates per second the tracker produces on this
participant's computer. If you like, it can also end the experiment on computers that are too
slow.

When a computer or browser cannot use the graphics card, saccade.js quietly switches to a slower
method and carries on, producing fewer gaze samples per second. Nothing stops and nothing warns
you. This trial gives you a number to check before your data depends on it.

The participant looks at a dot and holds still for about six seconds, which covers one second of
warm-up and five seconds of measurement.

```js
timeline.push({ type: jsPsychSaccadePerformance });
```

Put it after [`saccade-preview`](plugin-preview), which starts the camera, and before
[`saccade-calibrate`](plugin-calibrate). That way, nobody sits through calibration only to be
turned away.

| | |
| --- | --- |
| Package | `@saccadejs/plugin-performance` |
| Browser global | `jsPsychSaccadePerformance` |
| Trial type | `saccade-performance` |
| Requires | the [extension](extension). It starts the camera itself if needed, but it normally comes after [`saccade-preview`](plugin-preview) |

## Parameters

Exclusion works as it does in jsPsych's
[`browser-check`](https://www.jspsych.org/latest/plugins/browser-check/) plugin. You write an
`inclusion_function` that looks at the measurements and returns `true` or `false`, and an
`exclusion_message` for anyone who is excluded. If you already screen participants by browser or
screen size, this check reads the same way.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `stimulus` | `string` | a dot to look at | What to show while measuring. The tracker processes only frames with a face in them, so the default asks the participant to look at a dot and hold still. |
| `measurement_duration` | `number` | `5000` | How long to measure, in ms, after the warm-up. |
| `warmup_duration` | `number` | `1000` | How long to wait before measuring, in ms. The first frames are slow while the graphics card prepares the model and the camera adjusts its exposure. Counting them would make the computer look slower than it is. |
| `inclusion_function` | `(data) => boolean` | `() => true` | Receives the measurements (the fields under [Data](#data)). Return `true` to keep this participant. The default keeps everyone. |
| `exclusion_message` | `(data) => string` | a generic message | Receives the measurements and returns the HTML to show when `inclusion_function` returns `false`. |

## Data

| Field | Type | Description |
| --- | --- | --- |
| `fps_median` | `number \| null` | **The main result.** The typical number of gaze estimates per second (the median rate). `null` if it could not be measured because a face was never in view for two frames in a row. |
| `fps_mean` | `number \| null` | The average number of estimates per second, counting only the gaps between consecutive frames that both had a face in them. `null` when `fps_median` is. |
| `fps_p10` | `number \| null` | The rate at the slow end. One frame in ten was slower than this (the 10th percentile rate). `null` when `fps_median` is. See [below](#fps_p10-catches-what-the-median-hides). |
| `frames` | `number` | How many frames had a face in them. The rates are calculated from these. |
| `frames_without_face` | `number` | How many frames had no face in them. |
| `dropped` | `number` | Camera frames that arrived while the tracker was still busy and were never processed. A high count means the tracker fell behind the camera. |
| `embed_ms_median` | `number \| null` | The typical time the eye model took per frame, in ms. `null` if no frame with a face reached the model, and always in [deferred mode](#in-deferred-mode). |
| `backend` | `"webgpu" \| "wasm" \| null` | Whether the model ran on the graphics card (`"webgpu"`) or the slower processor path (`"wasm"`). `null` if the tracker never started, for example because the participant refused the camera or the model failed to load. |
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

While you pilot, leave `inclusion_function` out so nobody is excluded. Then look at `fps_median`
across your pilot participants to decide what threshold your study needs.

You can also send slow computers down a different path instead of ending the experiment. Leave
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

`fps_median` is the rate your experiment will run at, and so the rate at which gaze samples
appear in your data. saccade.js processes one camera frame at a time and waits to finish it before
taking the next. The rate therefore depends on whichever is slower, the camera delivering frames
or the computer processing them.

### Choose the threshold from your own design

saccade.js has no recommended threshold. How many samples per second a study needs depends on
what it measures, and nobody has studied this for saccade.js yet. Pilot without excluding anyone,
then choose a threshold from what you see.

One limit applies to every design. At _f_ samples per second, you cannot place an eye movement in
time more precisely than about `1000 / f` ms. That is about 67 ms at 15 samples per second and
about 33 ms at 30. Other sources of error add to this. If your design depends on _when_ someone
looked, also read [Timing and synchrony](../guides/timing-and-synchrony).

### `fps_p10` catches what the median hides

Some computers run well most of the time but stall now and then, for example when they get hot
and slow themselves down, or when another program wakes up. Such a computer can show a healthy
median while a fifth of its samples arrive far too late. One frame in ten falls below `fps_p10`,
so it drops only when slow frames make up at least a tenth of the measurement. A single short
hiccup will not move it.

### `embed_ms_median` tells you what is slow

Suppose `fps_median` is 15. If `embed_ms_median` is small, say 10 ms, the model is fast and the
camera is the limit, so a faster graphics card would not help. If `embed_ms_median` is large, say
60 ms, the model is the bottleneck. Check whether `backend` is `"wasm"`.

If `backend` is `"wasm"` on a computer that should support WebGPU, a wrong asset URL is one
possible cause. See [Hosting the assets](../guides/hosting-the-assets).

### When the measurement fails

If the rate could not be measured, `fps_median` is `null`. In JavaScript, `null >= 15` is
`false`, so the `inclusion_function` above excludes that participant. This is on purpose, since a
participant whose frame rate is unknown has not passed the check.

### Frames with no face do not count

A frame with no face in it never reaches the eye model, so it takes almost no time to process.
Counting those frames would report a rate the computer cannot keep up once it is tracking a face,
so saccade.js counts them separately as `frames_without_face`. A large number there means the
participant was out of view for part of the measurement, and the rates rest on less data than the
five seconds suggest.

### In deferred mode

In [deferred mode](../guides/deferred-mode), the eye model runs later on background threads.
The frame rate then measures only how fast saccade.js reads the camera and finds the face, which
is how many frames it queues for later. `embed_ms_median` is `null`. Every trial records the mode
in its `saccade_mode` column, so check that column when you read these numbers.
