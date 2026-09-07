# @saccadejs/plugin-time-sync

A [jsPsych](https://www.jspsych.org) plugin that measures the combined **display + camera lag** on
the participant's machine and applies it to the
[saccade.js](https://github.com/jspsych/saccadejs) extension, so gaze timestamps line up with
stimulus onsets.

## Why you need it

A gaze sample carries the camera frame's `captureTime`. But the photons left the screen some
milliseconds _before_ that stamp — the display's own lag, invisible to JavaScript — and the camera
pipeline added more of its own between the sensor and the timestamp. Both sit on the same
`performance.now()` timeline jsPsych uses for stimulus onsets, and their **sum** is the constant
you have to subtract from a gaze timestamp to line it up with what was actually on screen.

This plugin measures that sum with a screen→webcam loopback: it changes the whole screen between
two brightness levels at known random moments, watches the mean luminance of the webcam image (the
screen lights the participant's face and the room, so an ordinary user-facing webcam works), and
cross-correlates the two.

**There is no flicker.** The changes are at most one per second — the schedule is sparse, with gaps
of 0.5–1 s — which is a third of the WCAG 2.3.1 / Harding limit of three per second. The timing
information is in the edges, not the rate: about 20 edges over 15 seconds pin the lag down to a
few milliseconds.

Requires the [`@saccadejs/extension`](../extension-saccadejs) extension to be registered in
`initJsPsych`. Run it once, before your gaze-recording trials; put it after
[`saccade-preview`](../plugin-saccadejs-preview) so the camera is already running.

## Installation

```
npm install @saccadejs/core @saccadejs/extension @saccadejs/plugin-time-sync
```

## Usage

```html
<script src="https://unpkg.com/jspsych@8"></script>
<script src="https://unpkg.com/@saccadejs/core"></script>
<script src="https://unpkg.com/@saccadejs/extension"></script>
<script src="https://unpkg.com/@saccadejs/plugin-preview"></script>
<script src="https://unpkg.com/@saccadejs/plugin-time-sync"></script>
<script>
  const jsPsych = initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] });

  jsPsych.run([
    { type: jsPsychSaccadePreview },
    { type: jsPsychSaccadeTimeSync }, // measures and applies the offset
    // ... calibrate, then your trials
  ]);
</script>
```

The trial shows the instructions with a start button first, then a progress readout while the
screen changes, then ends. When `apply_offset` is true the measured lag is handed to
`extension.setTimingOffset()`, and every later trial's `saccade_data[].t` has it subtracted (and
`saccade_timing.corrected` is `true`).

## Parameters

| Parameter      | Type                    | Default       | Description                                                                                                                                      |
| -------------- | ----------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `duration`     | integer                 | `15000`       | How long the measurement runs, in ms. Longer gives more edges and a tighter estimate.                                                            |
| `gap_min`      | integer                 | `500`         | Minimum gap between brightness changes, in ms.                                                                                                   |
| `gap_max`      | integer                 | `1000`        | Maximum gap between brightness changes, in ms.                                                                                                   |
| `contrast`     | `"full"` \| `"reduced"` | `"full"`      | `"full"` switches between black and white (strongest signal); `"reduced"` uses dark grey and light grey — gentler, but noisier.                  |
| `instructions` | HTML string             | _(see below)_ | Shown before the measurement starts. The default explains what is about to happen and states that it is not a flickering display.                |
| `button_text`  | string                  | `"Start"`     | Text of the button that begins the measurement.                                                                                                  |
| `require_ok`   | boolean                 | `false`       | If true, an `UNRELIABLE` result is measured once more before continuing. The trial always continues either way; `verdict` records what happened. |
| `apply_offset` | boolean                 | `true`        | Apply the measured lag to the extension.                                                                                                         |

## Data generated

| Name               | Type    | Description                                                                                                                                  |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `lag_ms`           | float   | The measured display + camera lag. The constant to subtract from a gaze timestamp to put it on the stimulus clock.                           |
| `plateau_width_ms` | float   | Width of the range of lags consistent with every observed edge — the uncertainty on `lag_ms`. One camera frame (~33 ms) or less is expected. |
| `peak_d`           | float   | Peak of the edge-difference statistic, 0–1. Below 0.5 means the camera never really saw the screen change.                                   |
| `halves_ms`        | array   | `[first, second]` — the lag estimated separately from each half of the run. Numbers that disagree mean the lag drifted.                      |
| `camera_period_ms` | float   | Mean interval between camera frames (33.3 for a 30 fps camera).                                                                              |
| `camera_jitter_ms` | float   | Standard deviation of that interval.                                                                                                         |
| `dropped_frames`   | integer | Camera frames the browser reported dropping during the run.                                                                                  |
| `raf_period_ms`    | float   | Mean interval between animation frames (16.7 on a 60 Hz display).                                                                            |
| `clock_source`     | string  | `"captureTime"` (best), `"receiveTime"`, or `"callback"` (the browser gave no capture timestamp at all).                                     |
| `verdict`          | string  | `"OK"`, `"INCONCLUSIVE"` or `"UNRELIABLE"`. See below.                                                                                       |
| `reason`           | string  | A short explanation of a non-`OK` verdict; `null` when the verdict is `OK`.                                                                  |
| `applied`          | boolean | Whether the lag was applied to the extension.                                                                                                |
| `rt`               | integer | Time from the start of the trial until the measurement finished.                                                                             |

Every field is `null` if the measurement threw (no camera, for instance); the trial still ends so
the experiment can continue.

## Verdicts

| Verdict          | Meaning                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"OK"`           | The estimate is well constrained: a strong edge signal (`peak_d ≥ 0.5`), a plateau no wider than one camera frame (≤ 34 ms), and the two halves of the run agreeing. |
| `"INCONCLUSIVE"` | The signal was too weak or there were too few usable edges. Usually a very dim screen, a camera pointed away from the light, or aggressive auto-exposure.            |
| `"UNRELIABLE"`   | The run produced an estimate that contradicts itself — typically the two halves disagreeing. Do not use `lag_ms` from such a run.                                    |

`apply_offset` applies whatever was measured, so if your analysis depends on the correction, check
the verdict yourself:

```js
{
  type: jsPsychSaccadeTimeSync,
  apply_offset: false,
  on_finish: (data) => {
    if (data.verdict === "OK") {
      jsPsych.extensions.saccade.setTimingOffset(data.lag_ms);
    }
  },
}
```

## How much of this can you trust?

The loopback measures display lag and camera lag as one number, anchored on photons. It has been
checked against an external hardware clock — a photodiode taped to the screen and an LED in the
webcam's view on an RP2040, relaying screen edges to the camera after a known delay — so the
residual after applying the correction is zero-mean, with a spread set by the camera's exposure
window (up to half a frame). See the
[timing guide](https://saccade.jspsych.org/guides/timing-and-synchrony/) for the details.

## License

MIT
