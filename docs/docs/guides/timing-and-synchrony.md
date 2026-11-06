---
id: timing-and-synchrony
title: Timing and synchrony
sidebar_label: Timing and synchrony
description: When to run the time-sync trial, what the measured offset means, and how to read the verdict.
---

# Timing and synchrony

This page is for studies where _when_ someone looked matters as much as _where_. How long after a
face appears does the participant look at it? Which picture were they looking at when a word was
spoken?

## The problem

Suppose a picture appears on screen at 1,000 ms, and the participant's eyes jump to it at
1,200 ms. You want the gaze data to say 1,200. Without correction it will say something later,
such as 1,280, because of two delays that neither you nor the browser can see:

- **The display delay.** The monitor needs a little time to show a new image after the browser
  draws it.
- **The camera delay.** The camera needs time to capture a frame and hand it to the browser, and
  the browser may stamp the frame with a time later than the moment of capture.

Together these make up the _lag_. It depends on the participant's monitor, camera, browser, and
computer, so a value measured on your machine will not carry over to theirs.

The `saccade-time-sync` trial measures the lag on each participant's own setup. SaccadeJS then
subtracts it from every gaze timestamp recorded afterwards.

## Adding it to your timeline

```js
timeline.push({ type: jsPsychSaccadePreview });     // start the camera first
timeline.push({ type: jsPsychSaccadeTimeSync });    // then measure the lag
timeline.push({ type: jsPsychSaccadeCalibrate });
```

The trial needs the camera running, so it goes after `saccade-preview`. It does not need
calibration, so you can put it before `saccade-calibrate` and get the flashing screen out of the
way while the participant is still in setup. Run it once per session. It takes fifteen seconds by
default. [How it works](how-it-works#measuring-the-screen-to-camera-delay) describes what happens
during those fifteen seconds.

## What you get

The trial saves the measured lag as `lag_ms`. By default it also hands the lag to the extension,
which subtracts it from `t` in every later trial's `saccade_data`. You do not need to do anything
else.

To check what happened, look at the `saccade_timing` object on any trial that records gaze. For
example:

```json
{ "offset_ms": 78, "corrected": true, "clock": "captureTime",
  "dropped_frames": 1, "fps": 29.6, "smoothing_frames": 1, "trial_start": 48213.7 }
```

| Field | What it tells you |
| --- | --- |
| `offset_ms` | The lag that was subtracted from `t`, in ms. `null` if time sync never ran, or if its verdict was not `OK`. |
| `corrected` | `true` if the lag was subtracted. |
| `clock` | Where the camera timestamps came from. `"captureTime"` is what you want. See [Reading the verdict](#reading-the-verdict). |
| `dropped_frames` | How many camera frames the browser reported dropping during the trial. |
| `fps` | Camera frames per second the tracker was processing at the end of the trial. |
| `smoothing_frames` | How many frames were averaged into each estimate (1 unless you changed it). |
| `trial_start` | The moment `t` counts from, as a `performance.now()` value. Use it to line up your own events. See [Timing your own events](#timing-your-own-events). |

**Do not correct twice.** `lag_ms` already includes the display delay, so do not also subtract a
figure from the monitor's spec sheet or a measurement of your own. Processing time is excluded
too, because `t` marks when the camera captured the frame, and the time SaccadeJS spent on it
afterwards does not count.

## Reading the verdict

The time-sync trial also saves a `verdict`, which says whether you can trust the measurement.

| What you see | What it means |
| --- | --- |
| `verdict: "OK"` | The measurement is trustworthy, and SaccadeJS applies it. |
| `verdict: "UNRELIABLE"`, and `peak_d` is low | The camera did not clearly see the screen change brightness. A dim monitor, the camera adjusting its own exposure, or something blocking the lens can cause this. |
| `verdict: "UNRELIABLE"`, and `plateau_width_ms` is wide | Too few brightness changes to pin down the lag. A longer run (the `duration` parameter) gives more. |
| `verdict: "UNRELIABLE"`, and the two `halves_ms` values are far apart | The first and second halves of the run gave different answers, so the lag changed during the measurement. |
| `verdict: "INCONCLUSIVE"` | No usable camera frames, or fewer than two brightness changes seen. The `reason` field says which. |
| `clock_source: "receiveTime"` | The browser reported when frames arrived instead of when they were captured. The measured lag includes the difference, so an `OK` result is still usable. |
| `clock_source: "callback"` | The browser did not report when frames were captured, so the number is not a real measurement. See [Browser compatibility](browser-compatibility#capture-timestamps). |

SaccadeJS applies only an `OK` measurement. After any other verdict it saves the lag without
subtracting it, and later trials show `saccade_timing.corrected: false`.

Set `require_ok: true` to have the trial try once more after an `UNRELIABLE` result. Either way
the experiment carries on afterwards, so you decide in your analysis whether to exclude the
participant.

## Deciding which trials to exclude

`saccade_timing` has what you need to find trials with untrustworthy timestamps. Two checks
follow from how the correction works. Keep a trial only if:

- SaccadeJS subtracted the lag (`corrected` is `true`), and
- the browser reported real capture times (`clock` is `"captureTime"`).

You may also want to drop trials where the tracker ran slowly or dropped many frames. How slow is
too slow depends on your design, and nobody has measured it for SaccadeJS yet, so the numbers
below are placeholders. Pick your own from pilot data and settle them before you collect:

```js
const minFps = 20;            // placeholder: choose from your pilot data
const maxDroppedShare = 0.05; // placeholder: choose from your pilot data

const untrustworthy = (d) =>
  !d.saccade_timing.corrected ||
  d.saccade_timing.clock !== "captureTime" || // also drops "receiveTime"; allow it if you wish
  d.saccade_timing.fps < minFps ||
  d.saccade_timing.dropped_frames > maxDroppedShare * d.saccade_data.length;
```

## Timing your own events

`t` counts from the start of the trial, which SaccadeJS records as `saccade_timing.trial_start`.
Anything shown when the trial starts is at `t` = 0, give or take a frame.

For anything that happens later in the trial, such as a word played after one second or a picture
that changes partway through, record the time yourself. Call `performance.now()` at the moment you
make the change, and save it in the trial data relative to `trial_start`:

```js
const word = new Audio("word.mp3");
let wordOnset = null;

timeline.push({
  type: jsPsychHtmlKeyboardResponse,
  stimulus: "<img id='scene' src='scene.png'>",
  extensions: [{ type: jsPsychExtensionSaccade }],
  on_load: () => {
    // Play the word one second into the trial, and note when it really started.
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

Some things to keep in mind:

- **Record when it happened.** Writing `data: { word_onset: 1000 }` records the plan. Timers can
  fire late, especially while the tracker is busy with a camera frame, and the data would never
  show it. `performance.now()` records the real moment.
- **Do not subtract `offset_ms` from your own events.** That correction moves gaze timestamps back
  to when things happened on screen. Your events already carry the time they happened.
- **Sound has its own delay.** The time-sync trial measures the screen and the camera, and it
  knows nothing about the speakers. If audio timing matters to your design, also record
  `AudioContext.outputLatency` alongside the onset.
- **Expect about one screen refresh of slack.** A change you make in code appears at the next
  screen refresh, so an onset recorded this way is accurate to about 17 ms on a typical 60 Hz
  monitor. Gaze samples from a 30 frames per second camera are 33 ms apart, so the refresh is
  rarely what limits you.

## Gaze-contingent designs

In a gaze-contingent design, the display changes in response to where the participant is looking,
for example revealing a word only when the eyes reach it. What matters here is how old a gaze
estimate is by the time your code can act on it.

That age is `frame.time.emit - frame.time.capture` (from the [core API](../reference/core-api#frametime)),
plus the time your own code takes to redraw, plus the display delay again on the way back to
the participant. Expect the full loop, from eye movement to changed screen, to take well over
100 ms. Averaging frames makes it longer, so leave `smoothing_frames` at its default of 1 and
accept a slightly noisier estimate.

Gaze-contingent designs need live mode. With the extension's `mode` set to `"auto"` or
`"deferred"`, a computer running in [deferred mode](deferred-mode) produces no gaze until after
the trial. `onGazeUpdate` and `getCurrentPrediction` stay silent, and your display stops
responding without any error. Leave `mode` at `"live"` and use
[`saccade-performance`](../reference/plugin-performance) to turn away computers that are too
slow.

Every field on this page is documented in the
[`saccade-time-sync` reference](../reference/plugin-time-sync).
