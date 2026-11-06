---
id: plugin-calibrate
title: saccade-calibrate
sidebar_label: saccade-calibrate
description: Calibrate the tracker for each participant by having them look at a series of dots.
---

# `saccade-calibrate`

Calibration teaches the tracker how this participant's eyes look when they look at different
places on the screen. The tracker cannot estimate gaze until calibration has run.

The participant sees a dot jump from one position to the next. At each position, a ring shrinks
onto the dot for one second while their eyes settle on it. The ring then turns green for half a
second while the tracker records. With the default thirteen positions, the trial takes about
twenty seconds.

When the last dot is done, SaccadeJS fits an equation that turns the tracker's description of
the eyes into a screen position. The equation is a ridge regression, and
[How it works](../guides/how-it-works#calibration-and-validation) has the details.

```js
timeline.push({ type: jsPsychSaccadeCalibrate });
```

Follow it with [`saccade-validate`](plugin-validate) to measure how well calibration worked.

| | |
| --- | --- |
| Package | `@saccadejs/plugin-calibrate` |
| Browser global | `jsPsychSaccadeCalibrate` |
| Trial type | `saccade-calibrate` |
| Requires | the [extension](extension) and a running camera, so it comes after [`saccade-preview`](plugin-preview) |

## Tips for participants

Ask participants to:

- move their eyes to each dot and keep their head still,
- sit the way they will sit for the rest of the experiment, and stay that way.

A calibration holds only for the head position it was recorded in. If a participant leans in or
slumps afterwards, accuracy drops. Your instructions could say, for example: "Get comfortable now,
because you'll need to keep this position until the end."

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `calibration_points` | `[number, number][]` | 13 points (see below) | Where to put the dots, as `[x, y]` pairs in percent of the window's width and height. `[50, 50]` is the center, and `[5, 95]` is near the bottom-left corner. |
| `calibration_mode` | `"view" \| "click"` | `"view"` | `"view"` records automatically after the settle time. `"click"` waits for the participant to click each dot. |
| `repetitions_per_point` | `number` | `1` | How many times to go through the whole set of dots. |
| `randomize_calibration_order` | `boolean` | `false` | Show the dots in a random order, reshuffled on each repetition. |
| `time_to_saccade` | `number` | `1000` | How long to wait at each dot before recording, in ms, so the eyes have time to get there. The ring shrinks onto the dot during this time. Not used in `"click"` mode, where recording starts as soon as the dot is clicked. |
| `time_per_point` | `number` | `500` | How long to record at each dot, in ms. The ring is green during this time. |
| `point_size` | `number` | `20` | Diameter of the dot, in pixels. The ring is four times this size. |
| `lambda` | `number \| null` | `null` | How strongly to keep the fit from over-fitting a small number of dots (the ridge penalty). `null` picks a value for you: 3 with the default `"frames"` fit. Most studies should leave it alone. |
| `fit` | `"frames" \| "points" \| null` | `null` | How the fit uses the frames recorded at each dot. `"frames"` uses each frame on its own. `"points"` averages each dot's frames first, as SaccadeJS did up to version 0.3, and its automatic penalty is 3 for nine dots or fewer and 1 for more. `null` uses the tracker's setting, which is `"frames"` unless you changed it. |
| `clear_previous` | `boolean` | `true` | Throw away any calibration from earlier in the experiment before starting. Set `false` to add more dots to an existing calibration. |
| `processing_message` | `string` | "Processing. This can take a few seconds." | [Deferred mode](../guides/deferred-mode) only. HTML shown after the last dot while the background threads finish processing this trial's frames, with a progress percentage under it. |

The default thirteen dots are a 3 × 3 grid at 5%, 50% and 95% across and down, plus four more
in between at 27.5% and 72.5%:

```js
[
  [5, 5], [50, 5], [95, 5],
  [5, 50], [50, 50], [95, 50],
  [5, 95], [50, 95], [95, 95],
  [27.5, 27.5], [72.5, 27.5], [27.5, 72.5], [72.5, 72.5],
]
```

## Data

| Field | Type | Description |
| --- | --- | --- |
| `calibration_points_px` | `[number, number][]` | The dots that were shown, in the order they appeared, in **pixels** on this participant's screen. (The `calibration_points` parameter is in percent.) |
| `n_points` | `number` | How many different dot positions were used. |
| `repetitions_per_point` | `number` | How many times the set of dots was shown. |
| `lambda` | `number \| null` | The ridge penalty used, or `null` if calibration failed. |
| `fit` | `string \| null` | Whether the fit used every frame (`"frames"`) or one average per dot (`"points"`), or `null` if calibration failed. |
| `weighting` | `string \| null` | Whether blinks and other poor frames counted for less in the fit: `"model"` (weighted by the eye model's own quality rating), `"head"` (weighted by a separate rating you supplied to the tracker), or `"uniform"` (every frame counted equally). `null` if calibration failed. Report it in your methods, because a weighted and an unweighted calibration are different analyses. |
| `processing_ms` | `number \| null` | [Deferred mode](../guides/deferred-mode) only. How long the participant waited after the last dot while SaccadeJS processed the frames. `null` in live mode. |
| `rt` | `number` | Milliseconds from the start of the trial to the end of calibration. |

## Example

A denser 25-dot grid, in random order, with a little more time at each dot:

```js
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

At 1.8 seconds per dot, this takes about 45 seconds.
