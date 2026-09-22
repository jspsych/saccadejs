---
id: plugin-validate
title: saccade-validate
sidebar_label: saccade-validate
description: Measure gaze accuracy on points the calibration never saw.
---

# `saccade-validate`

Measures how accurate the tracker is for this participant, right after calibration.

**What the participant sees:** another series of dots, nine by default. They look at each one for
about three seconds (one to get there, two while gaze is recorded), about half a minute in all.
saccade.js compares where it estimated they were looking with where the dot actually was.

The dots are deliberately in different places from the calibration dots (all but the center one).
Measuring on the calibration dots themselves would make accuracy look better than it really is,
because the calibration was built to fit those. Measuring on new positions tells you how well it
works in general.

**The number to report is `median_error_viewport`**: the typical distance between the estimate
and the dot, as a fraction of the window's size. For example, `0.08` means estimates typically
landed about 8% of the window's size away from the dot, which is roughly 80 pixels on a window
1,000 pixels wide. Because it is a fraction, it can be compared across participants with
different screen sizes.

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
| `validation_points` | `[number, number][]` | 9 points: a 3 × 3 grid at 15%, 50% and 85% | Where to put the dots, as `[x, y]` pairs. How they are read depends on `validation_point_coordinates`. |
| `validation_point_coordinates` | `"percent" \| "center-offset-pixels"` | `"percent"` | `"percent"`: percent of the window's width and height, so `[50, 50]` is the center. `"center-offset-pixels"`: pixels from the center, so `[-200, 0]` is 200 pixels left of center. |
| `roi_radius` | `number` | `200` | The radius, in pixels, of a circle around each dot. Samples inside it count as "on target" for `percent_in_roi`. |
| `randomize_validation_order` | `boolean` | `false` | Show the dots in a random order. |
| `time_to_saccade` | `number` | `1000` | How long to wait at each dot before recording, in ms, so the eyes have time to get there. |
| `validation_duration` | `number` | `2000` | How long to record gaze at each dot, in ms. |
| `point_size` | `number` | `20` | Diameter of the dot, in pixels. |
| `show_validation_data` | `boolean` | `false` | At the end, show every gaze sample plotted against the dots. Useful while piloting; do not use it with real participants. |

## Data

**The summary:**

| Field | Type | Description |
| --- | --- | --- |
| `median_error_viewport` | `number` | **The number to report.** The typical error across dots, as a fraction of the window's size. Comparable across screen sizes. |
| `median_error_px` | `number` | The same error in pixels on this participant's screen. For each dot, the distance from the dot to the average of the gaze samples recorded there; then the median across dots. |
| `samples_per_sec` | `number` | The average number of gaze samples per second while recording. |
| `rt` | `number` | Milliseconds from the start of the trial to the end of validation. |

**Per dot:** each of these is an array with one entry per dot, in the order the dots were shown.

| Field | Type | Description |
| --- | --- | --- |
| `validation_points` | `[number, number][]` | The dot positions used. |
| `average_offset` | `{x, y, r}[]` | How far off the estimates were at each dot, on average. `x` and `y` are the average offset from the dot in pixels (the _accuracy_). `r` is how spread out the individual samples were around that average, as the median distance from it (the _precision_). |
| `percent_in_roi` | `number[]` | The percentage of samples that landed within `roi_radius` pixels of the dot. |
| `raw_gaze` | `{x, y, dx, dy, t}[][]` | Every gaze sample recorded at each dot. `x` and `y` are pixels on the screen; `dx` and `dy` are how far that sample was from the dot; `t` is milliseconds since the trial started. |

Accuracy and precision are different things. An `average_offset` of `{x: 60, y: 0, r: 10}` means
the estimates were tightly clustered (precise) but consistently 60 pixels to the right of the dot
(not accurate).

## Example: a second chance at calibration

If the first calibration goes badly, for example because the participant moved, it is often worth
trying once more before excluding them. This timeline validates, then, only if the error is too
large, recalibrates and validates again:

```js
const validate = { type: jsPsychSaccadeValidate };

// A placeholder. Choose your own threshold from pilot data before collecting.
const maxError = 0.1;

const recalibrateIfBad = {
  timeline: [{ type: jsPsychSaccadeCalibrate }, validate],
  conditional_function: () => {
    const last = jsPsych.data.get().filter({ trial_type: "saccade-validate" }).last(1).values()[0];
    return last.median_error_viewport > maxError;
  },
};

timeline.push(validate, recalibrateIfBad);
```

## Choosing an exclusion threshold

There is no recommended cutoff for `median_error_viewport`. How much error a study can tolerate
depends on the design (two large pictures on either side of the screen can tolerate much more
than a line of small words), and it has not been measured for saccade.js. Run a pilot, look at the
spread of errors, and fix your exclusion threshold before you start collecting.

**Checking for drift.** Adding a second `saccade-validate` trial at the end of the experiment
measures how much accuracy changed over the session, for example because the participant shifted
in their seat.
