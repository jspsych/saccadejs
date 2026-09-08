---
id: plugin-time-sync
title: saccade-time-sync
sidebar_label: saccade-time-sync
description: Measure this participant's screen-to-camera lag and apply it to gaze timestamps.
---

# `saccade-time-sync`

Measures how long it takes for something on this participant's screen to reach their camera, and
subtracts that from every later gaze timestamp. The screen steps between two brightness levels
at random moments about once a second while the camera watches. There is at most one change per
second, so it is not a flickering display.

| | |
| --- | --- |
| Package | `@saccadejs/plugin-time-sync` |
| Browser global | `jsPsychSaccadeTimeSync` |
| Trial type | `saccade-time-sync` |
| Requires | the [extension](extension) and a running camera, so it comes after [`saccade-preview`](plugin-preview) |
| Wraps | [`runLoopback`](core-api#runloopback) |

```js
timeline.push({ type: jsPsychSaccadeTimeSync });
```

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `duration` | `number` | `15000` | Length of the measurement, in ms. Longer runs give more edges and a tighter estimate. |
| `gap_min` | `number` | `500` | Minimum interval between brightness changes, in ms. |
| `gap_max` | `number` | `1000` | Maximum interval, in ms. |
| `contrast` | `"full" \| "reduced"` | `"full"` | `"full"` is black and white; `"reduced"` is dark gray and light gray, gentler but noisier. |
| `instructions` | `HTML string` | an explanation of the brightness test | Shown before the run. |
| `button_text` | `string` | `"Start"` | Text of the button that starts the measurement. |
| `require_ok` | `boolean` | `false` | Rerun once on an `UNRELIABLE` verdict. The trial continues either way. |
| `apply_offset` | `boolean` | `true` | Hand the measured lag to the extension, so later trials have it subtracted. |

## Data

| Field | Type | Description |
| --- | --- | --- |
| `lag_ms` | `number` | The measured display plus camera lag, in ms. |
| `plateau_width_ms` | `number` | Width of the range of lags consistent with every edge: the uncertainty. One camera frame (about 33 ms) or less is expected. |
| `peak_d` | `number` | Height of the edge-difference peak, 0–1. Below 0.5 the camera did not clearly see the screen change. |
| `halves_ms` | `[number, number]` | The estimate from each half of the run. |
| `camera_period_ms` | `number` | Mean camera frame interval. |
| `camera_jitter_ms` | `number` | Its standard deviation. |
| `dropped_frames` | `number` | Camera frames the browser reported dropping. |
| `raf_period_ms` | `number` | Mean animation-frame interval, effectively the display refresh. |
| `clock_source` | `"captureTime" \| "receiveTime" \| "callback"` | Anything but `"captureTime"` makes `lag_ms` advisory. |
| `verdict` | `"OK" \| "INCONCLUSIVE" \| "UNRELIABLE"` | |
| `reason` | `string \| null` | Why, when the verdict is not `"OK"`. |
| `applied` | `boolean` | Whether the offset was set on the extension. |
| `rt` | `number` | Milliseconds from trial start to the end of the measurement. |

The verdict is `"OK"` when `peak_d` is at least 0.5, the plateau is at most 34 ms, and the two
halves agree: within 8 ms when there are at least 15 edges per half, within 20 ms otherwise.

## Example

```js
timeline.push({
  type: jsPsychSaccadeTimeSync,
  contrast: "reduced",
  duration: 20000,
  instructions: `
    <h3>One quick screen test</h3>
    <p>For the next twenty seconds the background will change between dark and light every
    second or so, while your camera watches the screen. It does not flash or flicker.</p>
    <p>This measures how long your screen and camera take to respond, so that we can line up
    what you looked at with when it appeared.</p>`,
});
```

See [Timing and synchrony](../guides/timing-and-synchrony) for how to read the verdict and what
the correction leaves behind.
