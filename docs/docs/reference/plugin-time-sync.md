---
id: plugin-time-sync
title: saccade-time-sync
sidebar_label: saccade-time-sync
description: Measure this participant's screen-to-camera lag and apply it to gaze timestamps.
---

# `saccade-time-sync`

`saccade-time-sync` measures how long a change on the participant's screen takes to show up in
their camera. saccade.js then subtracts that delay from every gaze timestamp recorded afterwards.
Use it when your study cares about _when_ people looked as well as _where_, for example when you
measure how quickly the eyes reach a target.
[Timing and synchrony](../guides/timing-and-synchrony) explains why the delay exists and how to
use the result.

For fifteen seconds, the whole screen switches between black and white (or dark and light gray)
at random moments, every half second to a second. The participant's face gets brighter and darker
with the screen, and the camera picks that up, so the camera never needs to see the screen
itself. The screen changes at most twice a second. That stays under the limit of three flashes a
second that web accessibility guidelines (WCAG) set to protect people with photosensitive
epilepsy.

```js
timeline.push({ type: jsPsychSaccadeTimeSync });
```

| | |
| --- | --- |
| Package | `@saccadejs/plugin-time-sync` |
| Browser global | `jsPsychSaccadeTimeSync` |
| Trial type | `saccade-time-sync` |
| Requires | the [extension](extension). It starts the camera itself if needed, but it normally comes after [`saccade-preview`](plugin-preview) |
| Built on | [`runLoopback`](core-api#runloopback) from the core library |

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `duration` | `number` | `15000` | How long to measure, in ms. A longer run sees more screen changes and gives a more precise result. |
| `gap_min` | `number` | `500` | The shortest time between screen changes, in ms. |
| `gap_max` | `number` | `1000` | The longest time between screen changes, in ms. |
| `contrast` | `"full" \| "reduced"` | `"full"` | `"full"` switches between black and white. `"reduced"` uses dark and light gray. That is gentler on the eyes but harder for the camera to see, so the result is less precise. |
| `instructions` | `HTML string` | an explanation of the test | Shown before the measurement starts. |
| `button_text` | `string` | `"Start"` | The label on the button that starts the measurement. |
| `require_ok` | `boolean` | `false` | If the verdict is `"UNRELIABLE"`, run the measurement once more. The experiment continues either way. |
| `apply_offset` | `boolean` | `true` | If the verdict is `"OK"`, subtract the measured delay from gaze timestamps in all later trials. With any other verdict, saccade.js records the delay but does not apply it. |

## Data

### Main results

| Field | Type | Description |
| --- | --- | --- |
| `lag_ms` | `number` | The measured delay from screen to camera, in ms. This is the number saccade.js subtracts. |
| `verdict` | `"OK" \| "INCONCLUSIVE" \| "UNRELIABLE" \| null` | Whether the measurement can be trusted. See [how the verdict is decided](#how-the-verdict-is-decided). |
| `reason` | `string \| null` | Why the verdict is not `"OK"`, when it is not. |
| `applied` | `boolean` | Whether saccade.js will subtract the delay from later trials. |
| `clock_source` | `"captureTime" \| "receiveTime" \| "callback"` | Where the browser's frame timestamps came from. Only `"captureTime"` gives a real measurement. With anything else, treat `lag_ms` as a rough guide. |

### Quality checks

These fields decide the verdict.

| Field | Type | Description |
| --- | --- | --- |
| `plateau_width_ms` | `number` | How uncertain `lag_ms` is, in ms. The camera takes a picture only every 33 ms or so, so a range of delays fits the data equally well. This is the width of that range. Expect one camera frame (about 33 ms) or less. |
| `peak_d` | `number` | How clearly the camera saw the screen change, from 0 to 1. Below 0.6, it did not see the changes clearly. |
| `halves_ms` | `[number, number]` | The delay measured separately from the first and second halves of the run. If they disagree, the delay changed during the measurement. |

### Camera and display

| Field | Type | Description |
| --- | --- | --- |
| `camera_period_ms` | `number` | The average time between camera frames, in ms. |
| `camera_jitter_ms` | `number` | How much that time varied (its standard deviation). |
| `dropped_frames` | `number` | Camera frames the browser reported dropping. |
| `raf_period_ms` | `number` | The average time between screen redraws, in ms. This is usually the screen's refresh interval, about 16.7 ms at 60 Hz. |
| `rt` | `number` | Milliseconds from the start of the trial to the end of the measurement. |

If the measurement fails outright, for example because the participant refuses camera access, the
trial still ends and the experiment continues. Every field is then `null` except `rt` and
`applied`, which is `false`.

### How the verdict is decided

The verdict is `"INCONCLUSIVE"` when there was nothing to measure, meaning no usable camera frames
or fewer than two screen changes. Otherwise it is `"OK"` when all three of these hold, and
`"UNRELIABLE"` when any fails:

- `peak_d` is at least 0.6 (the camera clearly saw the changes),
- `plateau_width_ms` is at most 34 ms (the delay is pinned down to within about one camera frame),
- the two `halves_ms` agree, within 8 ms if each half saw at least 15 screen changes or within
  20 ms if fewer. This check fails if there were too few camera frames to measure each half.

If the verdict is not `"OK"`, [Timing and synchrony](../guides/timing-and-synchrony#reading-the-verdict)
explains what to do.

## Example

A gentler version with gray levels. It runs for longer to make up for the lower contrast, and
its instructions tell the participant what to expect:

```js
timeline.push({
  type: jsPsychSaccadeTimeSync,
  contrast: "reduced",
  duration: 20000,
  instructions: `
    <h3>One quick screen test</h3>
    <p>For the next twenty seconds the background will change between dark and light every
    second or so. Please keep looking at the screen.</p>
    <p>This measures how long your screen and camera take to respond, so that we can line up
    what you looked at with when it appeared.</p>`,
});
```
