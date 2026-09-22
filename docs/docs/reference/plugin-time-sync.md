---
id: plugin-time-sync
title: saccade-time-sync
sidebar_label: saccade-time-sync
description: Measure this participant's screen-to-camera lag and apply it to gaze timestamps.
---

# `saccade-time-sync`

Measures how long it takes for a change on this participant's screen to show up in their camera,
and subtracts that delay from every gaze timestamp recorded afterwards. You need it if your study
cares about _when_ people looked, not just _where_.
[Timing and synchrony](../guides/timing-and-synchrony) explains why the delay exists and how to
use the result.

**What the participant sees:** the whole screen switches between black and white (or dark and
light gray) at random moments, every half second to a second, for fifteen seconds. The camera
watches the screen while this happens. The screen never changes more than twice a second, so it
does not flicker.

```js
timeline.push({ type: jsPsychSaccadeTimeSync });
```

| | |
| --- | --- |
| Package | `@saccadejs/plugin-time-sync` |
| Browser global | `jsPsychSaccadeTimeSync` |
| Trial type | `saccade-time-sync` |
| Requires | the [extension](extension) and a running camera, so it comes after [`saccade-preview`](plugin-preview) |
| Built on | [`runLoopback`](core-api#runloopback) from the core library |

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `duration` | `number` | `15000` | How long to measure, in ms. A longer run sees more screen changes and gives a more precise result. |
| `gap_min` | `number` | `500` | The shortest time between screen changes, in ms. |
| `gap_max` | `number` | `1000` | The longest time between screen changes, in ms. |
| `contrast` | `"full" \| "reduced"` | `"full"` | `"full"` switches between black and white. `"reduced"` uses dark and light gray, which is gentler on the eyes but harder for the camera to see, so the result is less precise. |
| `instructions` | `HTML string` | an explanation of the test | Shown before the measurement starts. |
| `button_text` | `string` | `"Start"` | The label on the button that starts the measurement. |
| `require_ok` | `boolean` | `false` | If the result is `UNRELIABLE`, run the measurement once more. The experiment continues either way. |
| `apply_offset` | `boolean` | `true` | Subtract the measured delay from gaze timestamps in all later trials. |

## Data

**The main results:**

| Field | Type | Description |
| --- | --- | --- |
| `lag_ms` | `number` | The measured delay from screen to camera, in ms. This is what gets subtracted. |
| `verdict` | `"OK" \| "INCONCLUSIVE" \| "UNRELIABLE"` | Whether the measurement can be trusted. See [how the verdict is decided](#how-the-verdict-is-decided). |
| `reason` | `string \| null` | When the verdict is not `"OK"`, why. |
| `applied` | `boolean` | Whether the delay was passed on to be subtracted from later trials. |
| `clock_source` | `"captureTime" \| "receiveTime" \| "callback"` | Where the browser's frame timestamps came from. Only `"captureTime"` gives a real measurement; with anything else, treat `lag_ms` as a rough guide. |

**Quality checks**, used to decide the verdict:

| Field | Type | Description |
| --- | --- | --- |
| `plateau_width_ms` | `number` | How uncertain `lag_ms` is, in ms. The camera only takes a picture every 33 ms or so, so any delay within that window fits equally well; this is the width of the window. One camera frame (about 33 ms) or less is expected. |
| `peak_d` | `number` | How clearly the camera saw the screen change, from 0 to 1. Below 0.5 it did not see it clearly. |
| `halves_ms` | `[number, number]` | The delay measured from the first half of the run and from the second half, separately. If they disagree, the delay changed during the measurement. |

**Camera and display health:**

| Field | Type | Description |
| --- | --- | --- |
| `camera_period_ms` | `number` | The average time between camera frames, in ms. |
| `camera_jitter_ms` | `number` | How much that time varied (its standard deviation). |
| `dropped_frames` | `number` | Camera frames the browser reported dropping. |
| `raf_period_ms` | `number` | The average time between screen redraws, in ms. In practice, the screen's refresh interval: about 16.7 ms at 60 Hz. |
| `rt` | `number` | Milliseconds from the start of the trial to the end of the measurement. |

### How the verdict is decided

The verdict is `"OK"` when all three of these are true:

- `peak_d` is at least 0.5 (the camera clearly saw the changes),
- `plateau_width_ms` is at most 34 ms (the delay is pinned down to within about one camera frame),
- the two `halves_ms` agree: within 8 ms if each half saw at least 15 screen changes, or within
  20 ms if fewer.

[Timing and synchrony](../guides/timing-and-synchrony#reading-the-verdict) explains what to do
when it is not.

## Example

A gentler version with gray levels, run for longer to make up for the lower contrast, and with
instructions that tell the participant what to expect:

```js
timeline.push({
  type: jsPsychSaccadeTimeSync,
  contrast: "reduced",
  duration: 20000,
  instructions: `
    <h3>One quick screen test</h3>
    <p>For the next twenty seconds the background will change between dark and light every
    second or so, while your camera watches the screen. It does not flash or flicker.</p>
    <p>This measures how long your screen and camera take to respond, so that we can line up
    what you looked at with when it appeared.</p>`,
});
```
