---
id: deferred-mode
title: Slow computers and deferred mode
sidebar_label: Slow computers
description: How SaccadeJS keeps tracking on computers too slow to run the model in real time, and what that costs your design.
---

# Slow computers and deferred mode

SaccadeJS runs a neural network on every camera frame. With a capable graphics card that takes
about 20 ms, well inside the 33 ms between frames. Many participants have slower computers.
Without WebGPU, the model runs on the processor and can take a quarter of a second per frame. At
that speed the model holds up everything else on the page. The face tracker misses frames, and
key presses are slow to register.

Deferred mode keeps those participants in your study. SaccadeJS still does the time-sensitive
work live: it reads the camera, finds the face, and cuts out the picture of the eyes. It keeps the
eye pictures in memory and hands them to one or more background threads, which run the model while
the experiment carries on. Each trial's gaze appears once the threads catch up. The SaccadeJS
validation study ran this way on its slower machines.

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
| `"auto"`           | When the camera starts, SaccadeJS times the model on this computer. It stays live if the model uses WebGPU and each frame takes at most 85% of the time between camera frames, with that limit kept between 30 and 80 ms (30 ms if it cannot measure the camera's frame rate). Otherwise it switches to deferred. On a 30 frames per second camera, for example, the limit is 28 ms, raised to the 30 ms floor. |
| `"deferred"`       | Always deferred. Handy for testing your experiment on a fast computer.                                                                                                                                                                         |

Every trial records the mode in effect as `saccade_mode`. After `start()`,
`jsPsych.extensions.saccade.getModeDecision()` returns the numbers behind an `"auto"` decision:
how long the model took, the camera's frame rate, and the limit SaccadeJS compared them against.

If the background threads cannot start (say the computer runs out of memory), SaccadeJS stays
live and carries on. `saccade_mode` then says `"live"`, and `getModeDecision().error` says why.

## What changes in deferred mode

**Gaze-contingent displays stop working.** Gaze arrives seconds or minutes after the camera
captured the frame, so `onGazeUpdate`, `getCurrentPrediction` and the gaze dot stay empty. If your
display reacts to where the participant is looking, use `"live"`, and use the
[`saccade-performance`](../reference/plugin-performance) trial to turn away computers that are
too slow.

**Calibration and validation end with a short wait.** SaccadeJS cannot fit the calibration until
it has processed its frames, so `saccade-calibrate` shows a progress message after the last dot
until it finishes. `saccade-validate` does the same before it scores the gaze. Both record how
long the participant waited as `processing_ms`. Change the message with `processing_message`.

**`saccade_data` fills in after each trial.** A recording trial ends as usual, with `saccade_data`
empty. Its frames wait in a queue, and the rows appear in that trial's data once the background
threads reach them. The trial's `saccade_deferred` field tracks the progress:

| Field      | Meaning                                          |
| ---------- | ------------------------------------------------ |
| `frames`   | Camera frames with a face that the trial queued. |
| `embedded` | How many of them have been processed so far.     |
| `lost`     | Frames that never will be (see below).           |
| `complete` | `true` once `saccade_data` is final.             |

Partway through, a trial's data might hold `{ frames: 412, embedded: 150, lost: 0, complete: false }`.

The rows match live mode: the same pixels, the same `t` measured from the start of the trial, and
the same timing correction. SaccadeJS maps each frame with the calibration in place when the
trial ran, even if a later calibration replaced it.

SaccadeJS queues frames only from trials with the extension attached, and only once a
calibration exists. Instructions, breaks, and other trials without the extension cost nothing.

## Letting the queue catch up

The background threads work through every trial, but on a slow computer they may fall behind
while you record gaze. They catch up whenever recording stops. The `saccade-catch-up` trial waits
for them to finish, and shows the participant a progress bar and an estimate of the time left:

```js
timeline.push({ type: jsPsychSaccadeCatchUp });
```

**Put one at the end of the experiment, before you save the data.** Data saved earlier is missing
the gaze rows still in the queue. In live mode the trial ends at once, so you can safely include
it in every experiment.

Deferred mode suits designs that record gaze only part of the time, because the queue empties
during instructions, questionnaires, and breaks. A catch-up trial in a break between blocks keeps
the final wait short.

While it waits, the catch-up trial pauses the face tracker so the background threads get the whole
processor. It records how many frames were waiting (`frames_waiting`) and how long the participant
waited (`wait_ms`).

### Setting a time limit

By default `saccade-catch-up` waits as long as it takes. To limit the wait, set `max_wait` in
milliseconds. When time runs out, SaccadeJS gives up on the frames still queued and counts them
as `lost` in their trials' `saccade_deferred`.

To keep those frames instead, set `save_unprocessed_crops: true`. SaccadeJS then saves their eye
pictures in their trials' `saccade_deferred.crops`, along with each picture's timestamp and the
calibration that applies to it. You can run the model on them later, outside the browser, and
lose nothing. Each picture is a 144 × 36 grayscale strip across both eyes, about 5 KB (about 7 KB
once encoded as text in the data). **Each one is a recognisable picture of the participant's
eyes.** Check what your consent form and data-sharing plan allow before you turn this on, and
delete the pictures once you have processed them.

```js
timeline.push({
  type: jsPsychSaccadeCatchUp,
  max_wait: 60000, // give up after one minute
  save_unprocessed_crops: true,
});
```

## How many background threads

By default SaccadeJS starts one thread per processor core, minus two, with at least one and at
most three. A computer with 4 GB of memory or less gets one, because in piloting for the
validation study those computers could not handle more. Only Chrome and Edge report memory, so in
other browsers the core count alone decides. An 8-core laptop with 16 GB, for example, gets three
threads. Each thread holds its own copy of the model, about 20 MB, plus the runtime that runs it.
Override the number with `deferred_workers`:

```js
initJsPsych({
  extensions: [{ type: jsPsychExtensionSaccade, params: { mode: "auto", deferred_workers: 1 } }],
});
```

The queue holds up to 10,000 frames (about 50 MB), which is about five and a half minutes of
recording at 30 frames per second if the threads processed none of it. Frames that arrive when the
queue is full are lost.

## Hosting

The background threads load the model from `assets.modelUrl` and ONNX Runtime from
`assets.ortWasmUrl`. Both point to jsDelivr by default. That holds even if your bundler bundled
ONNX Runtime into the page, because the threads cannot reach the page's copy. If you
[host the assets yourself](hosting-the-assets), set both and deferred mode uses your copies.
SaccadeJS starts the threads from a `blob:` URL, so a page with a Content-Security-Policy needs
`worker-src blob:`.

## Using deferred mode without jsPsych

The core library exposes the same machinery. `tracker.enableDeferred()` starts the background
threads. After that, each frame carries its eye picture (`crop`) in place of an embedding.
`tracker.embedDeferred(crop)` queues one picture and resolves with its embedding, and
`predictSeries()` turns a run of embeddings into gaze. See the
[core API](../reference/core-api#deferred-mode).
