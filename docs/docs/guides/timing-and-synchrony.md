---
id: timing-and-synchrony
title: Timing and synchrony
sidebar_label: Timing and synchrony
description: When to run the time-sync trial, what the measured offset means, and how to read the verdict.
---

# Timing and synchrony

A camera frame's timestamp is not when the light left the screen. The display and the camera
each add delay, and the amount depends on the participant's hardware. The `saccade-time-sync` trial measures that delay for each participant and subtracts
it from every gaze timestamp.

## Run it once per session

```js
timeline.push({ type: jsPsychSaccadePreview });     // camera first
timeline.push({ type: jsPsychSaccadeTimeSync });    // then measure
timeline.push({ type: jsPsychSaccadeCalibrate });
```

It needs a running camera, so it must come after `saccade-preview`. It does not need a
calibration, so put it before `saccade-calibrate` and get the flashing out of the way while the
participant is still in setup mode. Fifteen seconds is the default. See
[How it works](how-it-works) for what happens during those fifteen seconds.

The lag is specific to the participant's screen, camera, browser and room, so a value measured
on your own machine does not transfer.

## What you get

The trial records `lag_ms`, the measured display plus camera delay. With `apply_offset: true`
(the default) it is handed to the extension, and every later trial's `saccade_data` timestamps
have it subtracted automatically. Nothing else to do.

Each trial also carries a `saccade_timing` object recording what was applied:

| Field | Meaning |
| --- | --- |
| `offset_ms` | The lag subtracted from `t`, or `null` if time sync never ran. |
| `corrected` | Whether the subtraction happened. |
| `clock` | Where camera timestamps came from. `"captureTime"` is the good one. |
| `dropped_frames` | Camera frames the browser reported dropping during the trial. |
| `fps` | Frame rate at the end of the trial. |
| `smoothing_frames` | Frames averaged per estimate. |
| `trial_start` | The `performance.now()` value `t` counts from. Subtract it from your own timestamps to put them on the same axis. |

**Do not correct twice.** `lag_ms` already contains the display latency, so do not also subtract
a display latency from a spec sheet or your own measurement. Processing time is already excluded
too, because `t` is a capture time rather than the time the prediction became available.

## Reading the verdict

| What you see | What it means |
| --- | --- |
| `verdict: "OK"` | The measurement held together, and it is applied automatically. |
| `verdict: "UNRELIABLE"`, low `peak_d` | The camera did not clearly see the screen change. A dim monitor, auto-exposure or a blocked lens can cause it. |
| `verdict: "UNRELIABLE"`, wide `plateau_width_ms` | Too few edges pinned the lag down. A longer `duration` gives more. |
| `verdict: "UNRELIABLE"`, `halves_ms` far apart | The lag changed during the run. |
| `verdict: "INCONCLUSIVE"` | No usable camera samples, or fewer than two edges. See `reason`. |
| `clock_source: "callback"` | The browser supplied no capture timestamps. The number is not a real measurement. |

Setting `require_ok: true` reruns an `UNRELIABLE` measurement once. The trial continues either
way, so exclusion is your decision to make in analysis.

## Exclusion criteria

`saccade_timing` carries what you need to exclude trials whose timestamps you cannot trust. Two
checks follow from the method: the correction was applied, and the browser supplied capture
timestamps. The frame rate and dropped-frame cutoffs depend on your design and have not been
measured for saccade.js, so the numbers below are placeholders. Set them from pilot data and fix
them before you collect:

```js
const minFps = 20;           // placeholder
const maxDroppedShare = 0.05; // placeholder

const bad = (d) =>
  !d.saccade_timing.corrected ||
  d.saccade_timing.clock !== "captureTime" ||
  d.saccade_timing.fps < minFps ||
  d.saccade_timing.dropped_frames > maxDroppedShare * d.saccade_data.length;
```

## Timing your own events

`t` counts from `saccade_timing.trial_start`, a `performance.now()` value stamped when the trial's
display loads. A stimulus the plugin draws at the start of the trial is at `t` ≈ 0.

For anything later in the trial, such as a spoken word or a second display change, take
`performance.now()` at the moment you make the change. Record it in the trial's own data,
relative to `trial_start`:

```js
const word = new Audio("word.mp3");
let wordOnset = null;

timeline.push({
  type: jsPsychHtmlKeyboardResponse,
  stimulus: "<img id='scene' src='scene.png'>",
  extensions: [{ type: jsPsychExtensionSaccade }],
  on_load: () => {
    jsPsych.pluginAPI.setTimeout(() => {
      word.play();
      wordOnset = performance.now();
    }, 1000);
  },
  on_finish: (data) => {
    data.word_onset = wordOnset === null ? null : wordOnset - data.saccade_timing.trial_start;
  },
});
```

`word_onset` and every `t` in `saccade_data` are now on one axis.

**Record the time, not the delay.** `data: { word_onset: 1000 }` records the plan. A timer can
fire late while the tracker is busy with a camera frame, and the data would not show it.

**Do not subtract `offset_ms`.** It moves gaze back to when the screen changed. Your events
already happened at that time.

**Sound has its own latency.** The time-sync trial measures the display and the camera, not the
speakers. If audio timing matters, record `AudioContext.outputLatency` beside the onset.

**Expect about a frame of slack.** A display change reaches the screen on a later frame, so an
onset stamped this way is good to about one refresh, 17 ms at 60 Hz. That is finer than the 33 ms
between gaze samples at 30 fps.

## Gaze-contingent designs

If you change the display in response to gaze, the number that matters is how stale an estimate
is by the time you can act on it: `frame.time.emit - frame.time.capture`, plus your own render
and the display latency again on the way out. Expect a closed loop well over 100 ms. Averaging
frames adds to it, so leave `smoothing_frames` at its default of 1 and accept a noisier estimate.

Every field listed here is documented in the
[`saccade-time-sync` reference](../reference/plugin-time-sync).
