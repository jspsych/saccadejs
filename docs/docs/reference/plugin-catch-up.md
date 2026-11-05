---
id: plugin-catch-up
title: saccade-catch-up
sidebar_label: saccade-catch-up
description: Wait for deferred mode's background threads to finish, so every trial's gaze data is complete.
---

# `saccade-catch-up`

In [deferred mode](../guides/deferred-mode), recording trials end before their gaze has been
computed. The frames wait in a queue for background threads, and each trial's `saccade_data` is
filled in when they are done. This trial waits for the queue to empty, showing the participant a
progress bar and an estimate of the time left.

```js
timeline.push({ type: jsPsychSaccadeCatchUp });
```

Put one at the end of the experiment, before the data is saved. A break between blocks is a good
place for another. In live mode the trial ends at once, so it is safe to include in every
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
| `max_wait`               | `number \| null` | `null`                                        | The longest to wait, in ms. `null` waits until every frame is processed. When the time runs out, the frames still queued are given up on and counted in their trials' `saccade_deferred.lost`.                                                                             |
| `save_unprocessed_crops` | `boolean`        | `false`                                       | Instead of discarding the frames given up on at `max_wait`, save their eye pictures in their trials' `saccade_deferred.crops`, to process offline. **The pictures show the participant's eyes**: see [Setting a time limit](../guides/deferred-mode#setting-a-time-limit). |
| `pause_tracking`         | `boolean`        | `true`                                        | Pause the face tracker while waiting, so the background threads get the whole processor. It starts again afterwards if it was running before.                                                                                                                              |
| `show_progress`          | `boolean`        | `true`                                        | Show a progress bar and an estimate of the time left under `message`.                                                                                                                                                                                                      |

## Data

| Field            | Type                   | Description                                                                                              |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `mode`           | `"live" \| "deferred"` | In live mode there is never anything to wait for.                                                        |
| `frames_waiting` | `number`               | Frames still waiting to be processed when the trial started.                                             |
| `frames_lost`    | `number`               | Frames that were never processed: given up on at `max_wait`, or lost earlier because the queue was full. |
| `timed_out`      | `boolean`              | Whether `max_wait` ran out before the queue emptied.                                                     |
| `crops_saved`    | `number`               | How many of the lost frames had their eye pictures saved.                                                |
| `wait_ms`        | `number`               | How long the participant waited, in ms.                                                                  |

## Processing saved eye pictures offline

Each trial with saved pictures has them in `saccade_deferred.crops`:

| Field      | Description                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `data`     | The pictures end to end, base64-encoded. Each is `width` × `height` (144 × 36) grayscale bytes, row by row.                          |
| `t`        | Each picture's timestamp, on the same axis as the trial's `saccade_data` `t`.                                                        |
| `kernel`   | The calibration in effect during the trial: `2 × d` numbers for a `d`-long embedding, x and y interleaved. `null` if there was none. |
| `center`   | The centering constant that goes with `kernel`.                                                                                      |
| `viewport` | `{width, height}`: the browser window's size in pixels, which the trial's other gaze samples were converted with.                    |

To turn a picture into gaze, run the model on it (input `[1, 36, 144, 1]` float32, the bytes as
0–255 values) and apply the calibration: `x = center + Σ embedding[i] × kernel[2i]`, and
`y = center + Σ embedding[i] × kernel[2i + 1]`. Gaze comes out as a fraction of the browser
window; multiply by `viewport.width` and `viewport.height` for pixels. This is what `predict()` in the
[core API](core-api) does.
