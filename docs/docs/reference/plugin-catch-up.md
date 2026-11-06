---
id: plugin-catch-up
title: saccade-catch-up
sidebar_label: saccade-catch-up
description: Wait for deferred mode's background threads to finish, so every trial's gaze data is complete.
---

# `saccade-catch-up`

In [deferred mode](../guides/deferred-mode), a recording trial can end before SaccadeJS has
computed its gaze. Its camera frames wait in a queue for the background threads, which fill in the
trial's `saccade_data` as they finish. This trial waits for the queue to empty, and shows the
participant a progress bar and an estimate of the time left.

```js
timeline.push({ type: jsPsychSaccadeCatchUp });
```

Put one at the end of the experiment, before you save the data. A break between blocks is a good
place for another. In live mode the trial ends at once, so you can safely include it in every
experiment.

|                |                              |
| -------------- | ---------------------------- |
| Package        | `@saccadejs/plugin-catch-up` |
| Browser global | `jsPsychSaccadeCatchUp`      |
| Trial type     | `saccade-catch-up`           |
| Requires       | the [extension](extension)   |

## Parameters

| Parameter                | Type             | Default                                       | Description                                                                                                                                                                                                                                                                |
| ------------------------ | ---------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`                | `string`         | "Finishing up. Please keep this window open." | HTML shown while waiting.                                                                                                                                                                                                                                                  |
| `max_wait`               | `number \| null` | `null`                                        | The longest to wait, in ms. `null` waits until every frame is processed. When time runs out, the trial abandons the frames still in the queue and counts them in their trials' `saccade_deferred.lost`.                                                                             |
| `save_unprocessed_crops` | `boolean`        | `false`                                       | Instead of discarding the frames abandoned at `max_wait`, save their eye pictures in their trials' `saccade_deferred.crops` so you can process them offline. **The pictures show the participant's eyes.** See [Setting a time limit](../guides/deferred-mode#setting-a-time-limit). |
| `pause_tracking`         | `boolean`        | `true`                                        | Pause the face tracker while waiting, so the background threads get the whole processor. The tracker restarts afterwards if it was running before.                                                                                                                              |
| `show_progress`          | `boolean`        | `true`                                        | Show a progress bar and an estimate of the time left under `message`.                                                                                                                                                                                                      |

## Data

| Field            | Type                   | Description                                                                                              |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `mode`           | `"live" \| "deferred"` | The mode in effect. In live mode there is never anything to wait for.                                                        |
| `frames_waiting` | `number`               | Frames still waiting to be processed when the trial started.                                             |
| `frames_lost`    | `number`               | Frames that were never processed, either abandoned at `max_wait` or lost earlier because the queue was full. |
| `timed_out`      | `boolean`              | Whether `max_wait` ran out before the queue emptied.                                                     |
| `crops_saved`    | `number`               | How many of the lost frames had their eye pictures saved.                                                |
| `wait_ms`        | `number`               | How long the participant waited, in ms.                                                                  |

## Processing saved eye pictures offline

Each trial with saved pictures keeps them in `saccade_deferred.crops`:

| Field      | Description                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `data`     | The pictures end to end, base64-encoded. Each is `width` × `height` (144 × 36) grayscale bytes, row by row.                          |
| `width`    | Width of each picture in pixels (144).                                                                                               |
| `height`   | Height of each picture in pixels (36).                                                                                               |
| `t`        | Each picture's timestamp, on the same axis as the trial's `saccade_data` `t`.                                                        |
| `kernel`   | The calibration in effect during the trial: `2 × d` numbers for a `d`-long embedding, x and y interleaved. `null` if there was none. |
| `center`   | The centering constant that goes with `kernel`.                                                                                      |
| `viewport` | `{width, height}`, the browser window's size in pixels. The trial's other gaze samples were converted to pixels with it.                    |

First split `data` into one picture per timestamp:

```js
const bytes = Uint8Array.from(atob(crops.data), (c) => c.charCodeAt(0));
const size = crops.width * crops.height; // 5,184 bytes per picture
const pictures = crops.t.map((_, i) => bytes.subarray(i * size, (i + 1) * size));
```

To turn a picture into gaze, run the model on it (input shape `[1, 36, 144, 1]`, float32, with the
bytes as 0–255 values) and apply the calibration:

- `x = center + Σ embedding[i] × kernel[2i]`
- `y = center + Σ embedding[i] × kernel[2i + 1]`

The result is a fraction of the browser window. Multiply by `viewport.width` and `viewport.height`
to get pixels. `predict()` in the [core API](core-api) does this calculation for you.

That gives one estimate per frame. If the trial's `saccade_timing.smoothing_frames` was above 1,
the tracker averaged that many embeddings into each estimate and timed it at their mean capture
time. Use `predictSeries()` from the core API to match it:

```js
import { predictSeries } from "@saccadejs/core";

// frames: [{ embedding: Float32Array, weight: number | null, time: t[i] }, ...] in order
const gaze = predictSeries(
  frames,
  Float32Array.from(crops.kernel),
  trial.saccade_timing.smoothing_frames,
  crops.center,
);
// each result is { gaze: { x, y }, time }, x and y as fractions of the window
```

`weight` is the model's second output, the frame usability rating. Pass `null` if your model
does not have one.
