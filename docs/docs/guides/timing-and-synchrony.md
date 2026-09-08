---
id: timing-and-synchrony
title: Timing and synchrony
sidebar_label: Timing and synchrony
description: When to run the time-sync trial, what the measured offset means, and how to read the verdict.
---

# Timing and synchrony

A camera frame's timestamp is not when the light left the screen. The display and the camera
each add delay, together usually 50 to 150 ms, and the amount depends on the participant's
hardware. The `saccade-time-sync` trial measures that delay for each participant and subtracts
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

**Do not correct twice.** `lag_ms` already contains the display latency, so do not also subtract
a display latency from a spec sheet or your own measurement. Processing time is already excluded
too, because `t` is a capture time rather than the time the prediction became available.

What is left after the correction is about half a camera exposure plus one display refresh,
roughly ±15 to 20 ms on typical hardware.

## Reading the verdict

| What you see | What it means |
| --- | --- |
| `verdict: "OK"`, `lag_ms` 40–150 | Normal. Use it. |
| `verdict: "UNRELIABLE"`, low `peak_d` | The camera could not see the screen change: a dim monitor, aggressive auto-exposure, or a blocked lens. |
| `verdict: "UNRELIABLE"`, `halves_ms` far apart | Something changed mid-run, usually the window losing focus. |
| `verdict: "INCONCLUSIVE"`, wide `plateau_width_ms` | Too few usable edges. Try a longer `duration`. |
| `clock_source: "callback"` | The browser supplied no capture timestamps. The number is not a real measurement. |

Setting `require_ok: true` reruns an `UNRELIABLE` measurement once. The trial continues either
way, so exclusion is your decision to make in analysis.

## Suggested exclusion criteria

Worth pre-registering:

```js
const bad = (d) =>
  !d.saccade_timing.corrected ||
  d.saccade_timing.clock !== "captureTime" ||
  d.saccade_timing.fps < 20 ||
  d.saccade_timing.dropped_frames > 0.05 * d.saccade_data.length;
```

## Gaze-contingent designs

If you change the display in response to gaze, the number that matters is how stale an estimate
is by the time you can act on it: `frame.time.emit - frame.time.capture`, plus your own render
and the display latency again on the way out. Expect a closed loop well over 100 ms. Averaging
frames adds to it, so leave `smoothing_frames` at its default of 1 and accept a noisier estimate.

Every field listed here is documented in the
[`saccade-time-sync` reference](../reference/plugin-time-sync).
