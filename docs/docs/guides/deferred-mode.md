---
id: deferred-mode
title: Slow computers and deferred mode
sidebar_label: Slow computers
description: How saccade.js keeps tracking on computers too slow to run the model in real time, and what that costs your design.
---

# Slow computers and deferred mode

saccade.js runs a neural network on every camera frame. On a computer with a capable graphics
card that takes about 20 ms, well inside the time between frames. Many participants' computers
are slower. Without WebGPU, the model runs on the processor and can take a quarter of a second
per frame. Run at that speed in the frame loop, the model holds up everything else on the page:
the face tracker misses frames, and key presses are slow to register.

Deferred mode keeps those participants in your study. The parts of tracking that have to happen
live still do: reading the camera, finding the face, and cutting out the picture of the eyes.
The eye pictures are kept in memory and handed to one or more background threads, which run the
model on them while the experiment carries on. Gaze for a trial is filled in once those threads
catch up. This is how the saccade.js validation study ran on its slower machines.

## Turning it on

```js
const jsPsych = initJsPsych({
  extensions: [{ type: jsPsychExtensionSaccade, params: { mode: "auto" } }],
});

const timeline = [
  { type: jsPsychSaccadePreview },
  { type: jsPsychSaccadeCalibrate },
  { type: jsPsychSaccadeValidate },
  // ... your trials, with the extension attached ...
  { type: jsPsychSaccadeCatchUp }, // before the data is saved
];
```

The `mode` setting takes three values:

| `mode`             | What happens                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"live"` (default) | The model runs on every frame as it arrives.                                                                                                                                                                                                    |
| `"auto"`           | When the camera starts, saccade.js times the model on this computer. It runs live if the model uses WebGPU and each frame takes less than 85% of the time between camera frames (but never more than 80 ms). Otherwise it switches to deferred. |
| `"deferred"`       | Always deferred. Useful for testing your experiment on a fast computer.                                                                                                                                                                         |

Every trial records which mode was in effect as `saccade_mode`. After `start()`,
`jsPsych.extensions.saccade.getModeDecision()` returns the numbers behind an `"auto"` decision:
how long the model took, the camera's frame rate, and the limit it was compared against.

If the background threads cannot start (for example, the computer runs out of memory),
saccade.js stays live and keeps going. `saccade_mode` then says `"live"`, and
`getModeDecision().error` says why.

## What changes in deferred mode

**Nothing gaze-contingent works.** Gaze arrives seconds or minutes after the frame was captured,
so `onGazeUpdate`, `getCurrentPrediction` and the gaze dot stay empty. If your display reacts to
where the participant is looking, use `"live"`, and use the
[`saccade-performance`](../reference/plugin-performance) trial to exclude computers that are
too slow.

**Calibration and validation end with a short wait.** Calibration cannot be fitted until its
frames have been processed, so `saccade-calibrate` shows a progress message after the last dot
until they are. `saccade-validate` does the same before it scores the gaze. Both record how long
the participant waited as `processing_ms`. Change the message with `processing_message`.

**`saccade_data` is filled in after each trial.** A recording trial ends as usual, with
`saccade_data` empty. Its frames wait in a queue, and the rows appear in that trial's data once
the background threads reach them. The trial's `saccade_deferred` field tracks the progress:

| Field      | Meaning                                          |
| ---------- | ------------------------------------------------ |
| `frames`   | Camera frames with a face that the trial queued. |
| `embedded` | How many of them have been processed so far.     |
| `lost`     | Frames that never will be (see below).           |
| `complete` | `true` once `saccade_data` is final.             |

The rows are the same as in live mode: the same pixels, the same `t` measured from the start of
the trial, and the same timing correction. Each frame is mapped with the calibration that was in
place when the trial ran, even if a later calibration replaced it.

Only frames from trials with the extension attached are queued, and only once a calibration
exists. Frames from instructions, breaks and other trials without the extension cost nothing.

## Letting the queue catch up

The background threads keep working during every trial, but on a slow computer they may fall
behind while gaze is being recorded. They catch up whenever recording stops. The
`saccade-catch-up` trial waits until they have finished, showing the participant a progress bar
and an estimate of the time left:

```js
timeline.push({ type: jsPsychSaccadeCatchUp });
```

**Put one at the end of the experiment, before the data is saved.** Data saved before the queue
has caught up is missing the gaze rows that were still waiting. In live mode the trial ends at
once, so it is safe to include in every experiment.

Designs where eye tracking runs only part of the time suit deferred mode best: the queue empties
during instructions, questionnaires and breaks. A catch-up trial during a break between blocks
keeps the wait at the end short.

The catch-up trial pauses the face tracker while it waits, so the background threads get the
whole processor. It records how many frames were waiting (`frames_waiting`) and how long the
participant waited (`wait_ms`).

### Setting a time limit

By default `saccade-catch-up` waits as long as it takes. To limit the wait, set `max_wait` in
milliseconds. When it runs out, the frames still queued are given up on and counted as `lost`
in their trials' `saccade_deferred`.

To keep those frames instead, set `save_unprocessed_crops: true`. Their eye pictures are then
saved in the data, in their trials' `saccade_deferred.crops`, along with each picture's
timestamp and the calibration that applies to it. You can run the model on them later yourself,
outside the browser, and nothing is lost. Each picture is a 144 × 36 grayscale strip across both
eyes, about 5 KB, and **it is a recognisable picture of the participant's eyes**. Check what your
consent form and data-sharing plan allow before you turn this on, and delete the pictures once
you have processed them.

```js
timeline.push({
  type: jsPsychSaccadeCatchUp,
  max_wait: 60000,
  save_unprocessed_crops: true,
});
```

## How many background threads

By default saccade.js starts one thread for every processor core beyond two, up to three. It
starts one on a computer with 4 GB of memory or less: in piloting for the validation study, those
computers could not handle more. Each thread holds its own copy of the model, about 20 MB, plus
the runtime that runs it. Override the number with `deferred_workers`:

```js
initJsPsych({
  extensions: [{ type: jsPsychExtensionSaccade, params: { mode: "auto", deferred_workers: 1 } }],
});
```

The queue holds up to 10,000 frames (about 50 MB). Frames that arrive when it is full are lost.
That is about five and a half minutes of recording at 30 frames per second, if the threads processed none of it.

## Hosting

The background threads load the model from `assets.modelUrl`, and ONNX Runtime from
`assets.ortWasmUrl`. That is jsDelivr by default, even if your bundler has bundled ONNX Runtime
into the page, because the threads cannot reach the page's copy. If you
[host the assets yourself](hosting-the-assets), set both and deferred mode uses your copies. The
threads are started from a `blob:` URL, so a page with a Content-Security-Policy needs
`worker-src blob:`.

## Using deferred mode without jsPsych

The core library exposes the same machinery. `tracker.enableDeferred()` starts the background
threads, after which each frame carries its eye picture (`crop`) instead of an embedding.
`tracker.embedDeferred(crop)` queues one and resolves with its embedding, and `predictSeries()`
turns a run of embeddings into gaze. See the [core API](../reference/core-api#deferred-mode).
