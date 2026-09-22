---
id: plugin-calibrate
title: saccade-calibrate
sidebar_label: saccade-calibrate
description: Fit the per-participant map from eye appearance to screen position.
---

# `saccade-calibrate`

Calibration teaches the tracker how this participant's eyes look when they are looking at
different places on their screen. Until it has run, the tracker cannot estimate gaze at all.

**What the participant sees:** a dot appears at one position after another. At each one, a ring
shrinks onto the dot for one second while the participant's eyes settle on it, then turns green
for half a second while the tracker records. With the default thirteen positions, the whole trial
takes about twenty seconds.

At the end, saccade.js fits an equation that turns the tracker's description of the eyes into a
screen position (a ridge regression; [How it works](../guides/how-it-works#calibration-and-validation)
has the details).

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

- move their eyes to each dot, not their head,
- sit the way they will sit for the rest of the experiment, and stay that way.

The calibration only holds for the head position it was recorded in. If a participant leans in
or slumps afterwards, accuracy suffers.

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `calibration_points` | `[number, number][]` | 13 points (see below) | Where to put the dots, as `[x, y]` pairs in percent of the window's width and height. `[50, 50]` is the center; `[5, 95]` is near the bottom-left corner. |
| `calibration_mode` | `"view" \| "click"` | `"view"` | `"view"` records automatically after the settle time. `"click"` waits for the participant to click each dot. |
| `repetitions_per_point` | `number` | `1` | How many times to go through the whole set of dots. |
| `randomize_calibration_order` | `boolean` | `false` | Show the dots in a random order, reshuffled on each repetition. |
| `time_to_saccade` | `number` | `1000` | How long to wait at each dot before recording, in ms, so the eyes have time to get there. The ring shrinks onto the dot during this time. |
| `time_per_point` | `number` | `500` | How long to record at each dot, in ms. The ring is green during this time. |
| `point_size` | `number` | `20` | Diameter of the dot, in pixels. The ring is four times this size. |
| `lambda` | `number \| null` | `null` | How strongly to keep the fit from over-fitting a small number of dots (the ridge penalty). `null` chooses automatically: 3 for nine dots or fewer, 1 for more. Most studies should leave it alone. |
| `clear_previous` | `boolean` | `true` | Throw away any calibration from earlier in the experiment before starting. Set `false` to add more dots to an existing calibration. |

The default thirteen dots are a 3 × 3 grid near the edges and center (at 5%, 50% and 95% across
and down), plus four more between them (at 27.5% and 72.5%).

## Data

| Field | Type | Description |
| --- | --- | --- |
| `calibration_points_px` | `[number, number][]` | The dots that were shown, in the order they appeared, in **pixels** on this participant's screen. (The `calibration_points` parameter is in percent.) |
| `n_points` | `number` | How many different dot positions were used. |
| `repetitions_per_point` | `number` | How many times the set of dots was shown. |
| `lambda` | `number` | The ridge penalty used, or `null` if calibration failed. |
| `weighting` | `string` | Whether blinks and other poor frames counted for less in the fit: `"model"` (weighted by the eye model's own quality rating), `"head"` (weighted by a separate rating you supplied to the tracker), or `"uniform"` (every frame counted equally). `null` if calibration failed. Report this: a weighted and an unweighted calibration are different methods. |
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
