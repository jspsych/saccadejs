---
id: plugin-validate
title: saccade-validate
sidebar_label: saccade-validate
description: Measure gaze accuracy on points the calibration never saw.
---

# `saccade-validate`

Shows a second set of targets and measures how far the predictions land from them. The default
points are inset from the calibration grid, so the result is a held-out accuracy estimate rather
than a fit statistic. `median_error_viewport` is the number to report.

| | |
| --- | --- |
| Package | `@saccadejs/plugin-validate` |
| Browser global | `jsPsychSaccadeValidate` |
| Trial type | `saccade-validate` |
| Requires | the [extension](extension) and a fitted calibration, so it comes after [`saccade-calibrate`](plugin-calibrate) |

```js
timeline.push({ type: jsPsychSaccadeValidate });
```

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `validation_points` | `[number, number][]` | 9 points: 3 × 3 at 15/50/85% | `[x, y]` pairs, interpreted by `validation_point_coordinates`. |
| `validation_point_coordinates` | `"percent" \| "center-offset-pixels"` | `"percent"` | Percentages of the viewport, or pixel offsets from its centre. |
| `roi_radius` | `number` | `200` | Radius in pixels of the region of interest around each point, used for `percent_in_roi`. |
| `randomize_validation_order` | `boolean` | `false` | Shuffle the order of the points. |
| `time_to_saccade` | `number` | `1000` | Settle time in ms before gaze is recorded. |
| `validation_duration` | `number` | `2000` | How long gaze is recorded at each point, in ms. |
| `point_size` | `number` | `20` | Diameter of the dot in pixels. |
| `show_validation_data` | `boolean` | `false` | Show the collected samples against the targets at the end. For piloting only. |

## Data

| Field | Type | Description |
| --- | --- | --- |
| `raw_gaze` | `{x, y, dx, dy, t}[][]` | One array per validation point, in the order the points were shown. `x`, `y` are viewport pixels; `dx`, `dy` the offset from the target; `t` is ms since the trial started. |
| `percent_in_roi` | `number[]` | Per point, the percentage of samples within `roi_radius` of the target. |
| `average_offset` | `{x, y, r}[]` | Per point, the average `x` and `y` offset from the target, plus `r`, the median distance of the individual samples from that average offset (precision). |
| `validation_points` | `[number, number][]` | The points used, in the order they were shown. |
| `samples_per_sec` | `number` | Average sampling rate across points. |
| `median_error_px` | `number` | Median across points of the distance from the target to the average gaze position. |
| `median_error_viewport` | `number` | The same error in viewport units, comparable across screen sizes. |
| `rt` | `number` | Milliseconds from trial start to the end of validation. |

## Example

```js
const validate = { type: jsPsychSaccadeValidate };

// Recalibrate once if the first validation is poor.
const recalibrateIfBad = {
  timeline: [{ type: jsPsychSaccadeCalibrate }, validate],
  conditional_function: () => {
    const last = jsPsych.data.get().filter({ trial_type: "saccade-validate" }).last(1).values()[0];
    return last.median_error_viewport > 0.12;
  },
};

timeline.push(validate, recalibrateIfBad);
```

## Interpreting `median_error_viewport`

| Value | What it supports |
| --- | --- |
| under 0.07 | Quadrants and well-separated regions. |
| 0.07 – 0.12 | Typical. Left/right and top/bottom distinctions, large regions of interest. |
| 0.12 – 0.20 | Coarse. Halves of the screen at best. |
| above 0.20 | The fit failed, or the participant moved. Recalibrate or exclude. |

Pick your exclusion threshold before collecting. Validating again at the end of the experiment
tells you how much the calibration drifted, which is worth reporting.
