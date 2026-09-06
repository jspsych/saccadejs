---
id: plugin-calibrate
title: saccade-calibrate
sidebar_label: saccade-calibrate
description: Fit the per-participant map from eye embedding to screen position.
---

# `saccade-calibrate`

Shows a sequence of targets, collects embeddings at each, and fits the ridge regression that
turns an eye appearance into a point on this participant's screen.

| | |
| --- | --- |
| Package | `@saccadejs/plugin-calibrate` |
| Browser global | `jsPsychSaccadeCalibrate` |
| Trial type | `saccade-calibrate` |
| Replaces | `@jspsych/plugin-webgazer-calibrate` |

Requires the [extension](extension) and a running camera, so it must come after
[`saccade-preview`](plugin-preview).

```js
timeline.push({ type: jsPsychSaccadeCalibrate });
```

## What it does

For each point in `calibration_points`:

1. Draw a dot with a ring around it and hold for `time_to_saccade` while the ring shrinks —
   this is the settle interval, giving the eyes time to arrive.
2. Turn the ring and dot **green** and collect every embedding for `time_per_point`.
3. Average them into one observation for that target.

After the last point, fit: `extension.fitCalibration(lambda)`. Until that fit runs, no gaze
estimate exists at all — which is the main behavioural difference from WebGazer's incremental
training.

The whole thing is about twenty seconds at the defaults: thirteen points at 1.5 s each.

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `calibration_points` | `[number, number][]` | the 13-point grid | `[x%, y%]` pairs, as WebGazer. The default is 3 × 3 at 5/50/95% plus four inner points at 27.5/72.5% — corners for range, inner points for curvature. |
| `calibration_mode` | `"view" \| "click"` | `"view"` | `"view"` samples automatically after the settle interval. `"click"` waits for the participant to click each point, as WebGazer's click mode, which guarantees they were looking but takes longer. |
| `repetitions_per_point` | `number` | `1` | Each point is visited this many times. |
| `randomize_calibration_order` | `boolean` | `false` | |
| `time_to_saccade` | `number` | `1000` | The settle interval, in ms, before sampling starts. |
| `time_per_point` | `number` | `500` | The capture interval, in ms. |
| `point_size` | `number` | `20` | Diameter of the dot, in pixels. |
| `lambda` | `number \| null` | `null` | Ridge penalty. `null` uses `lambdaFor(n)`: **3** for nine points or fewer, **1** above that. |
| `clear_previous` | `boolean` | `true` | Discard any earlier calibration points before starting. Set `false` to add points to an existing set — a mid-experiment top-up. |

## Data

| Field | Type | Description |
| --- | --- | --- |
| `calibration_points_px` | `[number, number][]` | The points actually used, **in pixels** — what the percentages resolved to in this participant's window. Named differently from the parameter on purpose: `calibration_points` stays the percentage input, so the two never silently swap units. |
| `n_points` | `number` | The number of **distinct targets** that produced a usable observation. Fewer than requested means some targets collected no embeddings — usually the face lost at the screen edges. |
| `repetitions_per_point` | `number` | The setting actually used, so `n_points × repetitions_per_point` gives the number of visits. |
| `lambda` | `number` | The penalty actually used. |
| `rt` | `number` | |

Check `n_points` against the length of `calibration_points_px` in your analysis. A participant
calibrated on eight of thirteen targets is a participant whose data is worth a second look.

## Example

```js
// A denser grid, randomised, for a study that can afford the extra time.
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

## Notes

- **More points is not automatically better.** The ridge fits 128 coefficients, so extra points
  mostly buy robustness rather than resolution, and a longer calibration is a calibration during
  which the head moves. Thirteen points is a deliberate compromise; twenty-five is reasonable if
  the participant is motivated.
- **Head movement is the enemy.** The fitted map is for the head pose that was there during
  calibration. Ask participants to move their eyes, not their head, and to hold the pose they
  will use for the experiment.
- **Recalibrate between blocks** for anything longer than a few minutes, and validate after each
  recalibration so you can see the drift you are correcting.
- **`clear_previous: false` needs care.** Adding points from a different head pose to points
  from the original one produces a fit that is wrong for both.
- **Then validate.** A calibration with no [validation](plugin-validate) is a calibration whose
  quality you are guessing at.
