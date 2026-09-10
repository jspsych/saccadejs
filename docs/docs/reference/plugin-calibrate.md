---
id: plugin-calibrate
title: saccade-calibrate
sidebar_label: saccade-calibrate
description: Fit the per-participant map from eye appearance to screen position.
---

# `saccade-calibrate`

Shows a sequence of targets, collects eye embeddings at each, and fits the regression that turns
an eye appearance into a point on this participant's screen. No gaze estimate exists until this
trial finishes. Thirteen points at the defaults takes about twenty seconds.

| | |
| --- | --- |
| Package | `@saccadejs/plugin-calibrate` |
| Browser global | `jsPsychSaccadeCalibrate` |
| Trial type | `saccade-calibrate` |
| Requires | the [extension](extension) and a running camera, so it comes after [`saccade-preview`](plugin-preview) |

```js
timeline.push({ type: jsPsychSaccadeCalibrate });
```

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `calibration_points` | `[number, number][]` | 13 points: 3 × 3 at 5/50/95% plus four at 27.5/72.5% | `[x, y]` pairs as a percentage of viewport width and height. |
| `calibration_mode` | `"view" \| "click"` | `"view"` | `"view"` captures automatically after the settle interval; `"click"` waits for the participant to click each point. |
| `repetitions_per_point` | `number` | `1` | How many times the whole sequence of points is repeated. |
| `randomize_calibration_order` | `boolean` | `false` | Shuffle the order on each repetition. |
| `time_to_saccade` | `number` | `1000` | Settle time in ms before capture starts. The ring shrinks onto the dot over this interval. |
| `time_per_point` | `number` | `500` | Capture time in ms at each point. The ring turns green. |
| `point_size` | `number` | `20` | Diameter of the dot in pixels. The ring is four times this size. |
| `lambda` | `number \| null` | `null` | Ridge penalty. `null` uses `lambdaFor(n)`: 3 for nine points or fewer, otherwise 1. |
| `clear_previous` | `boolean` | `true` | Discard calibration points collected earlier in the experiment before starting. |

## Data

| Field | Type | Description |
| --- | --- | --- |
| `calibration_points_px` | `[number, number][]` | The targets shown, in the order they appeared, in viewport **pixels**. The `calibration_points` parameter stays in percent. |
| `n_points` | `number` | The number of distinct targets used. |
| `repetitions_per_point` | `number` | How many times the sequence was repeated. |
| `lambda` | `number` | The ridge penalty the fit used, or `null` if the fit failed. |
| `weighting` | `string` | How the fit weighted its rows: `"model"` (the model's own per-frame weights), `"head"` (a `calHead` given to the tracker), or `"uniform"` (unweighted). `null` if the fit failed. |
| `rt` | `number` | Milliseconds from trial start to the end of calibration. |

## Example

```js
// A denser grid, randomized, for a study that can afford the extra time.
timeline.push({
  type: jsPsychSaccadeCalibrate,
  calibration_points: [
    [10, 10], [30, 10], [50, 10], [70, 10], [90, 10],
    [10, 30], [30, 30], [50, 30], [70, 30], [90, 30],
    [10, 50], [30, 50], [50, 50], [70, 50], [90, 50],
    [10, 70], [30, 70], [50, 70], [70, 70], [90, 70],
    [10, 90], [30, 90], [50, 90], [70, 90], [90, 90],
  ],
  randomize_calibration_order: true,
  time_to_saccade: 1200,
  time_per_point: 600,
});
```

Ask participants to move their eyes rather than their head, and to hold the pose they will use
for the rest of the experiment. Then [validate](plugin-validate).
