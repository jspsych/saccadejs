---
id: plugin-validate
title: saccade-validate
sidebar_label: saccade-validate
description: Measure held-out gaze accuracy on points the calibration never saw.
---

# `saccade-validate`

Shows a second set of targets and measures how far the fitted model's predictions land from
them. The points are not the calibration points, so the result is a held-out accuracy estimate
rather than a fit statistic.

| | |
| --- | --- |
| Package | `@saccadejs/plugin-validate` |
| Browser global | `jsPsychSaccadeValidate` |
| Trial type | `saccade-validate` |
| Replaces | `@jspsych/plugin-webgazer-validate` |

Requires the [extension](extension) and a **fitted calibration**, so it must come after
[`saccade-calibrate`](plugin-calibrate).

```js
timeline.push({ type: jsPsychSaccadeValidate });
```

## Parameters

The same names and meanings as WebGazer's validation plugin.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `validation_points` | `[number, number][]` | the 9-point grid | Interpreted according to `validation_point_coordinates`. The default is 3 × 3 at 15/50/85% — deliberately inset from, and offset against, the calibration grid. |
| `validation_point_coordinates` | `"percent" \| "center-offset-pixels"` | `"percent"` | `"percent"` is a fraction of the viewport; `"center-offset-pixels"` is pixels from the centre of the screen, which keeps a fixed visual angle across window sizes. |
| `roi_radius` | `number` | `200` | Radius in pixels of the region of interest around each point, used for `percent_in_roi`. |
| `randomize_validation_order` | `boolean` | `false` | |
| `time_to_saccade` | `number` | `1000` | Settle interval before measurement, in ms. |
| `validation_duration` | `number` | `2000` | How long gaze is collected at each point, in ms. Longer than calibration's capture window on purpose: this one is estimating a distribution, not a mean. |
| `point_size` | `number` | `20` | Diameter of the dot, in pixels. |
| `show_validation_data` | `boolean` | `false` | Show a scatter of the collected samples against the targets at the end of the trial. Useful in piloting; do not leave it on for participants, who will start compensating for it. |

## Data

WebGazer's fields, plus two summary numbers.

| Field | Type | Description |
| --- | --- | --- |
| `raw_gaze` | `{x, y, dx, dy, t}[][]` | One array per validation point, **in presentation order** — which is not the order of `validation_points` when `randomize_validation_order` is on, so index into them together. `x`, `y` are the sample in viewport pixels; `dx`, `dy` its offset from the target; `t` the sample time in ms from trial start, corrected the same way `saccade_data` is. |
| `percent_in_roi` | `number[]` | Per point: the percentage (0–100) of samples within `roi_radius` pixels of the target. |
| `average_offset` | `{x, y, r}[]` | Per point: mean signed offset in x and y, and the mean Euclidean distance `r`. Signed offsets are what reveal a systematic bias — a whole grid shifted downward means the head moved after calibration. |
| `validation_points` | `[number, number][]` | The points actually used, in presentation order. |
| `samples_per_sec` | `number` | Mean sampling rate across points, as WebGazer reports. A value well under the camera's frame rate means frames were being lost — check it before trusting the error estimate. |
| `median_error_px` | `number` | Median of the per-point errors, in pixels. |
| `median_error_viewport` | `number` | The same, as a fraction of the viewport — the number to compare across participants with different screens. |
| `rt` | `number` | |

## Example

```js
timeline.push({
  type: jsPsychSaccadeValidate,
  validation_points: [[-400, -300], [400, -300], [0, 0], [-400, 300], [400, 300]],
  validation_point_coordinates: "center-offset-pixels",
  validation_duration: 2500,
  roi_radius: 150,
  show_validation_data: true,   // piloting only
});
```

## Using the result

**Report it.** `median_error_viewport` across your sample, with its spread, belongs in your
methods section. It is the number that tells a reader whether your regions of interest were
resolvable.

**Set an exclusion threshold before you collect.** A conditional timeline can recalibrate or
end the session:

```js
const validate = { type: jsPsychSaccadeValidate };

const recalibrateIfBad = {
  timeline: [{ type: jsPsychSaccadeCalibrate }, validate],
  conditional_function: () => {
    const last = jsPsych.data.get().filter({ trial_type: "saccade-validate" }).last(1).values()[0];
    return last.median_error_viewport > 0.12;   // pick this in advance, not afterwards
  },
};

timeline.push(validate, recalibrateIfBad);
```

**Validate more than once.** A validation after calibration tells you the fit was good; a second
one at the end of the experiment tells you whether it stayed good. The difference between them
is drift, and it is the honest thing to report.

**Interpretation, roughly:**

| `median_error_viewport` | What it supports |
| --- | --- |
| under 0.07 | Quadrants, well-separated regions, a good session. |
| 0.07 – 0.12 | Typical. Left/right and top/bottom distinctions; large, well-spaced regions of interest. |
| 0.12 – 0.20 | Coarse. Halves of the screen at best. Consider recalibrating. |
| above 0.20 | The fit failed, or the participant moved. Recalibrate or exclude. |

Look at `average_offset` as well as the median. A grid of offsets all pointing the same way is
head movement and might be recoverable; offsets pointing in different directions at different
points are a bad fit and are not.
