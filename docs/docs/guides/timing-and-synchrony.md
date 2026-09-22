---
id: timing-and-synchrony
title: Timing and synchrony
sidebar_label: Timing and synchrony
description: When to run the time-sync trial, what the measured offset means, and how to read the verdict.
---

# Timing and synchrony

This page is for studies where _when_ someone looked matters, not only _where_. For example: how
long after a face appears does the participant look at it? Which picture were they looking at
when a word was spoken?

## The problem

Suppose a picture appears on screen at exactly 1,000 ms, and the participant's eyes jump to it
at 1,200 ms. You would like the gaze data to say 1,200. Without correction, it will say something
later, such as 1,280, because of two delays neither you nor the browser can see directly:

- **The display delay.** The monitor takes some time to actually show a new image after the
  browser draws it.
- **The camera delay.** The camera takes some time to capture a frame and hand it to the
  browser, and the time the browser stamps on it can be later than the moment the image was
  captured.

Together these are the _lag_. It depends on the participant's monitor, camera, browser, and
computer, so a value measured on your own machine does not carry over to theirs.

The `saccade-time-sync` trial measures the lag on each participant's own setup, and saccade.js
then subtracts it from every gaze timestamp recorded afterwards.

## Adding it to your timeline

```js
timeline.push({ type: jsPsychSaccadePreview });     // start the camera first
timeline.push({ type: jsPsychSaccadeTimeSync });    // then measure the lag
timeline.push({ type: jsPsychSaccadeCalibrate });
```

It needs the camera to be running, so it goes after `saccade-preview`. It does not need
calibration, so it can go before `saccade-calibrate`, which gets the screen switching out of the
way while the participant is still in setup. Run it once per session. It takes fifteen seconds by
default. [How it works](how-it-works#measuring-the-screen-to-camera-delay) describes what happens
during those fifteen seconds.

## What you get

The trial saves the measured lag as `lag_ms`. By default, it also hands the lag to the extension,
and every later trial's `saccade_data` has it subtracted from `t` automatically. There is nothing
else you need to do.

To check what happened, every trial that records gaze also carries a `saccade_timing` object:

| Field | What it tells you |
| --- | --- |
| `offset_ms` | The lag that was subtracted from `t`, in ms. `null` if time sync never ran. |
| `corrected` | `true` if the lag was subtracted. |
| `clock` | Where the camera timestamps came from. `"captureTime"` is what you want; see [Reading the verdict](#reading-the-verdict). |
| `dropped_frames` | How many camera frames the browser reported dropping during the trial. |
| `fps` | Camera frames per second the tracker was processing at the end of the trial. |
| `smoothing_frames` | How many frames were averaged into each estimate (1 unless you changed it). |
| `trial_start` | The moment `t` counts from, as a `performance.now()` value. Use it to line up your own events; see [Timing your own events](#timing-your-own-events). |

**Do not correct twice.** `lag_ms` already includes the display delay. Do not also subtract a
display delay from the monitor's spec sheet or a measurement of your own. The time saccade.js
spends processing each frame is also already excluded, because `t` is when the frame was
captured, not when the estimate was ready.

## Reading the verdict

The time-sync trial also saves a `verdict`: whether the measurement held together well enough
to trust.

| What you see | What it means |
| --- | --- |
| `verdict: "OK"` | The measurement is trustworthy, and it has been applied. |
| `verdict: "UNRELIABLE"`, and `peak_d` is low | The camera did not clearly see the screen change brightness. A dim monitor, the camera automatically adjusting its exposure, or something blocking the lens can cause this. |
| `verdict: "UNRELIABLE"`, and `plateau_width_ms` is wide | There were not enough brightness changes to pin down the lag. A longer run (the `duration` parameter) gives more. |
| `verdict: "UNRELIABLE"`, and the two `halves_ms` values are far apart | The first and second halves of the run gave different answers, so the lag changed while it was being measured. |
| `verdict: "INCONCLUSIVE"` | No usable camera frames, or fewer than two brightness changes seen. The `reason` field says which. |
| `clock_source: "callback"` | The browser did not report when frames were captured, so the number is not a real measurement. See [Browser compatibility](browser-compatibility#capture-timestamps). |

Setting `require_ok: true` makes the trial try once more after an `UNRELIABLE` result. Either way
the experiment continues afterwards, so whether to exclude a participant is a decision you make
in your analysis.

## Deciding which trials to exclude

`saccade_timing` holds what you need to find trials whose timestamps you should not trust. Two
checks follow directly from how the correction works:

- the lag was subtracted (`corrected` is `true`), and
- the browser reported real capture times (`clock` is `"captureTime"`).

You may also want to exclude trials where the tracker ran slowly or dropped many frames. How slow
is too slow depends on your design, and has not been measured for saccade.js, so the numbers
below are placeholders. Choose your own from pilot data, and fix them before you collect:

```js
const minFps = 20;            // placeholder: choose from your pilot data
const maxDroppedShare = 0.05; // placeholder: choose from your pilot data

const untrustworthy = (d) =>
  !d.saccade_timing.corrected ||
  d.saccade_timing.clock !== "captureTime" ||
  d.saccade_timing.fps < minFps ||
  d.saccade_timing.dropped_frames > maxDroppedShare * d.saccade_data.length;
```

## Timing your own events

`t` counts from the start of the trial, which saccade.js records as `saccade_timing.trial_start`.
Anything shown at the very start of the trial is at `t` = 0, give or take a frame.

For anything that happens later in the trial, such as a word played after one second, or a
picture that changes partway through, you need to record when it happened yourself. Do this by
calling `performance.now()` at the moment you make the change, and saving it in the trial data
relative to `trial_start`:

```js
const word = new Audio("word.mp3");
let wordOnset = null;

timeline.push({
  type: jsPsychHtmlKeyboardResponse,
  stimulus: "<img id='scene' src='scene.png'>",
  extensions: [{ type: jsPsychExtensionSaccade }],
  on_load: () => {
    // Play the word one second into the trial, and note exactly when.
    jsPsych.pluginAPI.setTimeout(() => {
      word.play();
      wordOnset = performance.now();
    }, 1000);
  },
  on_finish: (data) => {
    // Convert to the same scale as t in saccade_data.
    data.word_onset = wordOnset === null ? null : wordOnset - data.saccade_timing.trial_start;
  },
});
```

Now `word_onset` and every `t` in `saccade_data` are on the same timeline. If `word_onset` is
`1004`, a gaze row with `t: 1350` was recorded 346 ms after the word started.

A few things to keep in mind:

- **Record when it happened, not when you planned it.** Writing `data: { word_onset: 1000 }`
  would record the plan. Timers can fire late, especially while the tracker is busy processing a
  camera frame, and the data would never show it. Calling `performance.now()` records the truth.
- **Do not subtract `offset_ms` from your own events.** That correction moves gaze timestamps
  back to when things happened on screen. Your events are already stamped with when they happened.
- **Sound has its own delay.** The time-sync trial measures the screen and the camera, not the
  speakers. If the timing of audio matters to your design, also record
  `AudioContext.outputLatency` alongside the onset.
- **Expect about one screen refresh of slack.** A change you make in code appears on the next
  screen refresh, so an onset recorded this way is accurate to about one refresh: 17 ms on a
  typical 60 Hz monitor. That is finer than the 33 ms between gaze samples from a 30 frames per
  second camera, so it is rarely the limiting factor.

## Gaze-contingent designs

In a gaze-contingent design, the display changes in response to where the participant is looking,
for example revealing a word only when the eyes reach it. Here what matters is how old a gaze
estimate already is by the time your code can act on it.

That age is `frame.time.emit - frame.time.capture` (from the [core API](../reference/core-api#frametime)),
plus the time your own code takes to redraw, plus the display delay again on the way back to
the participant. Expect the full loop, from eye movement to changed screen, to take well over
100 ms. Averaging frames makes it longer, so leave `smoothing_frames` at its default of 1 and
accept a slightly noisier estimate.

Every field on this page is documented in the
[`saccade-time-sync` reference](../reference/plugin-time-sync).
