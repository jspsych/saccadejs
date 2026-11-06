---
id: plugin-validate
title: saccade-validate
sidebar_label: saccade-validate
description: Measure gaze accuracy on points the calibration never saw.
---

# `saccade-validate`

`saccade-validate` measures how accurate the tracker is for this participant. Run it right after
calibration.

The participant sees another series of dots, nine by default. They look at each dot for about
three seconds: one second to get there and two while saccade.js records gaze. The whole trial
takes about half a minute. saccade.js then compares where it estimated they were looking with
where each dot was.

Eight of the nine dots sit in places the calibration never used. Calibration fits its own dots as
closely as it can, so testing on those would make the tracker look more accurate than it is. New
positions show how well it works across the screen.

The number to report is `median_error_viewport`, the typical distance between the estimate and
the dot as a fraction of the window's diagonal. A 1,600 × 900 window has a diagonal of about
1,840 pixels, so a value of `0.08` there means the estimates typically landed about 150 pixels
from the dot. Because it is a fraction, you can compare it across participants with different
screen sizes and shapes.

```js
timeline.push({ type: jsPsychSaccadeValidate });
```

| | |
| --- | --- |
| Package | `@saccadejs/plugin-validate` |
| Browser global | `jsPsychSaccadeValidate` |
| Trial type | `saccade-validate` |
| Requires | the [extension](extension) and a finished calibration, so it comes after [`saccade-calibrate`](plugin-calibrate) |

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `validation_points` | `[number, number][]` | 9 points: a 3 × 3 grid at 15%, 50% and 85% across and down | Where to put the dots, as `[x, y]` pairs. `validation_point_coordinates` sets the units. |
| `validation_point_coordinates` | `"percent" \| "center-offset-pixels"` | `"percent"` | With `"percent"`, values are percent of the window's width and height, so `[50, 50]` is the center. With `"center-offset-pixels"`, values are pixels from the center, so `[-200, 0]` is 200 pixels left of center. |
| `roi_radius` | `number` | `200` | The radius, in pixels, of a circle around each dot. Samples inside it count as "on target" for `percent_in_roi`. |
| `randomize_validation_order` | `boolean` | `false` | Show the dots in a random order. |
| `time_to_saccade` | `number` | `1000` | How long to wait at each dot before recording, in ms, so the eyes have time to get there. |
| `validation_duration` | `number` | `2000` | How long to record gaze at each dot, in ms. |
| `point_size` | `number` | `20` | Diameter of the dot, in pixels. |
| `show_validation_data` | `boolean` | `false` | At the end, show every gaze sample plotted against the dots. Handy while piloting. Turn it off for real participants. |
| `processing_message` | `string` | "Processing. This can take a few seconds." | [Deferred mode](../guides/deferred-mode) only. HTML shown after the last dot while the background threads finish processing this trial's frames, with a progress percentage under it. |

## Data

### Summary

| Field | Type | Description |
| --- | --- | --- |
| `median_error_viewport` | `number \| null` | **The number to report.** The typical error across dots, as a fraction of the window's diagonal. Comparable across screen sizes and shapes. `null` if no gaze was recorded at any dot. |
| `median_error_px` | `number \| null` | The same error in pixels on this participant's screen. saccade.js averages the gaze samples at each dot, measures the distance from that average to the dot, and takes the median across dots. |
| `samples_per_sec` | `number \| null` | The average number of gaze samples per second while recording. `null` if no dot got two samples. |
| `processing_ms` | `number \| null` | [Deferred mode](../guides/deferred-mode) only. How long the participant waited after the last dot while saccade.js processed the frames. `null` in live mode. |
| `rt` | `number` | Milliseconds from the start of the trial to the end of validation. |

### Per dot

Each of these fields is an array with one entry per dot, in the order the dots appeared.

| Field | Type | Description |
| --- | --- | --- |
| `validation_points` | `[number, number][]` | The dot positions, in the units you gave in `validation_point_coordinates` (percent or pixels from center). Unlike [`saccade-calibrate`](plugin-calibrate), this plugin does not convert them to screen pixels. `[]` if validation failed partway, though `raw_gaze` may still hold the dots recorded before the failure. |
| `average_offset` | `{x, y, r}[]` | How far off the estimates were at each dot, on average. `x` and `y` are the average offset from the dot in pixels (the _accuracy_). `r` is how spread out the individual samples were around that average, as the median distance from it (the _precision_). `{x: null, y: null, r: null}` for a dot with no samples. |
| `percent_in_roi` | `number[]` | The percentage of samples that landed within `roi_radius` pixels of the dot. `0` for a dot with no samples. |
| `raw_gaze` | `{x, y, dx, dy, t}[][]` | Every gaze sample recorded at each dot. `x` and `y` are pixels on the screen, `dx` and `dy` are the sample's distance from the dot in pixels, and `t` is milliseconds since the trial started. |

Accuracy and precision can disagree. An `average_offset` of `{x: 60, y: 0, r: 10}` means the
estimates were tightly clustered (precise) but sat 60 pixels to the right of the dot (not
accurate).

## Example: a second chance at calibration

A calibration can go badly for simple reasons, such as the participant shifting in their seat.
Before you exclude someone, it is often worth one more try. This timeline validates, and if the
error is too large, it recalibrates and validates again:

```js
const validate = { type: jsPsychSaccadeValidate };

// A placeholder. Choose your own threshold from pilot data before collecting.
const maxError = 0.1;

const recalibrateIfBad = {
  timeline: [{ type: jsPsychSaccadeCalibrate }, validate],
  conditional_function: () => {
    const last = jsPsych.data.get().filter({ trial_type: "saccade-validate" }).last(1).values()[0];
    // `null` means nothing was recorded, which should also get a second attempt.
    return last.median_error_viewport === null || last.median_error_viewport > maxError;
  },
};

timeline.push(validate, recalibrateIfBad);
```

## Choosing an exclusion threshold

saccade.js has no recommended cutoff for `median_error_viewport`. The right one depends on your
design, and it has not been measured for saccade.js yet. Two large pictures on opposite sides of the screen can tolerate much more error
than a line of small words. Run a pilot, look at the spread of errors, and fix your exclusion
threshold before you start collecting.

To check for drift, add a second `saccade-validate` trial at the end of the experiment. Comparing
its error with the first one shows how much accuracy changed over the session.
