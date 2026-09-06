---
id: plugin-time-sync
title: saccade-time-sync
sidebar_label: saccade-time-sync
description: Measure this participant's screen-to-camera lag with the no-flicker loopback, and apply it.
---

# `saccade-time-sync`

Measures how long it takes for something on this participant's screen to reach their camera,
and subtracts that from every later gaze timestamp. There is no WebGazer equivalent; this is
the trial that turns "gaze samples with timestamps" into "gaze samples on the experiment's
clock".

| | |
| --- | --- |
| Package | `@saccadejs/plugin-time-sync` |
| Browser global | `jsPsychSaccadeTimeSync` |
| Trial type | `saccade-time-sync` |
| Wraps | [`runLoopback`](core-api#runloopback) |

Requires the [extension](extension), and a camera — so it must come after
[`saccade-preview`](plugin-preview).

```js
timeline.push({ type: jsPsychSaccadeTimeSync });
```

## What it does

Shows the instructions, waits for the button, then for `duration` milliseconds steps the page
between black and white at random intervals between `gap_min` and `gap_max` while the camera
watches the screen. The lag between each flip and the camera frame that first sees it, taken as
the plateau of an edge-difference estimator, is the whole screen-to-camera delay.

The flashing happens on a **full-viewport overlay appended to `document.body`**, not inside the
jsPsych display element — the whole screen has to change for enough light to reach the
participant's face, and a stimulus-sized patch would not. The jsPsych content is hidden
underneath for the duration and restored afterwards, so nothing in your page needs to know this
trial exists.

With `apply_offset: true` (the default) the result is handed to
`extension.setTimingOffset(lag)`, and every later trial's `saccade_data` has it subtracted and
records `saccade_timing.corrected: true`.

:::note This is not flicker
Gaps of at least half a second mean the screen changes at most twice a second — a slow
slideshow, orders of magnitude below any photosensitivity threshold. The sparseness is also
functional: a fixed-rate schedule would land at the same phase of the camera's frame clock
every time and bias the estimate by up to half a frame. The default `instructions` say this in
plain language; keep that reassurance if you rewrite them.
:::

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `duration` | `number` | `15000` | Length of the measurement, in ms. Shorter runs give fewer edges and a wider plateau. |
| `gap_min` | `number` | `500` | Minimum interval between brightness changes, in ms. |
| `gap_max` | `number` | `1000` | Maximum interval. |
| `contrast` | `"full" \| "reduced"` | `"full"` | `"full"` is black/white; `"reduced"` is `#333`/`#ccc` — gentler, but a weaker signal, so it may need a longer `duration`. |
| `instructions` | `HTML string` | A default explaining the brightness test and that it does not flicker | Shown before the run. |
| `button_text` | `string` | `"Start"` | |
| `require_ok` | `boolean` | `false` | When `true`, an `UNRELIABLE` verdict reruns the measurement once, then continues regardless. |
| `apply_offset` | `boolean` | `true` | Call `extension.setTimingOffset(lag_ms)` with the result. |

## Data

Every field of the underlying `LoopbackResult` that is worth keeping, flattened.

| Field | Type | Description |
| --- | --- | --- |
| `lag_ms` | `number` | **The measurement.** Display lag plus camera lag, in ms, on the `captureTime` clock. |
| `plateau_width_ms` | `number` | Width of the interval of lags consistent with every edge — the uncertainty. Bounded below by one camera frame period (33 ms at 30 fps). |
| `peak_d` | `number` | Height of the edge-difference peak, 0–1. Below 0.5 the screen change was not clearly visible to the camera. |
| `halves_ms` | `[number, number]` | The estimate from each half of the run. Disagreement means something changed mid-measurement. |
| `camera_period_ms` | `number` | Mean camera frame interval. |
| `camera_jitter_ms` | `number` | Its standard deviation. |
| `dropped_frames` | `number` | Camera frames presented but never seen by the loop. |
| `raf_period_ms` | `number` | Mean animation-frame interval — the display's refresh, effectively. |
| `clock_source` | `"captureTime" \| "receiveTime" \| "callback"` | Anything but `"captureTime"` makes `lag_ms` advisory rather than a measurement. |
| `verdict` | `"OK" \| "INCONCLUSIVE" \| "UNRELIABLE"` | |
| `reason` | `string \| null` | Why, when the verdict is not `"OK"`. |
| `applied` | `boolean` | Whether the offset was actually set. |
| `rt` | `number` | |

The verdict is `"OK"` when `peak_d ≥ 0.5`, the plateau is at most 34 ms, and the two halves
agree — within 8 ms when there are at least 15 edges per half, within 20 ms otherwise.

## Example

```js
timeline.push({
  type: jsPsychSaccadeTimeSync,
  contrast: "reduced",
  duration: 20000,          // a weaker signal needs more edges
  instructions: `
    <h3>One quick screen test</h3>
    <p>For the next twenty seconds the background will change between dark and light every
    second or so, while your camera watches the screen. It does not flash or flicker.</p>
    <p>This measures how long your screen and camera take to respond, so that we can line up
    what you looked at with when it appeared.</p>`,
});
```

## Reading the result

| What you see | What it means |
| --- | --- |
| `verdict: "OK"`, `lag_ms` 40–150 | Normal. Use it. |
| `verdict: "UNRELIABLE"`, low `peak_d` | The camera could not see the screen change — a very dim monitor, a camera with aggressive auto-exposure, or the participant blocking the lens. |
| `verdict: "UNRELIABLE"`, halves far apart | Something changed mid-run: the window lost focus, another animation started, the camera re-exposed. |
| `verdict: "INCONCLUSIVE"`, wide plateau | Too few edges, usually from a short `duration` or a low camera frame rate. |
| `clock_source: "callback"` | The browser has no `requestVideoFrameCallback` metadata. The number is not a real measurement; consider excluding the participant from timing analyses. |

## Do not double-correct

`lag_ms` **already contains the display latency**. If you also subtract a display latency from
another source — a measurement made on your own hardware, or a specification sheet — you will
over-correct by that whole amount. Likewise the processing latency is already excluded, because
`t` is a capture time and not an emit time.

What is left after this correction is half a camera exposure plus one refresh of display
jitter, roughly ±15–20 ms on typical hardware. [Timing and
synchrony](../guides/timing-and-synchrony) explains where that bound comes from and how the
loopback was validated against a photodiode-and-LED rig to under a millisecond.
