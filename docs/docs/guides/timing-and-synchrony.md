---
id: timing-and-synchrony
title: Timing and synchrony
sidebar_label: Timing and synchrony
description: What t means in a gaze sample, what the loopback measures, how it was validated against hardware, and what uncertainty is left.
---

# Timing and synchrony

Every gaze sample carries a `t`. This page is about what that number actually refers to, how
saccade.js corrects it, and — the part usually left out — how wrong it can still be.

## The problem

You show a stimulus at `performance.now() === 1000`. A camera frame arrives, you run the model,
and you get a gaze estimate. When was the participant looking there?

Three delays sit between the two events, and only one of them is visible from JavaScript:

1. **Display latency.** Your `requestAnimationFrame` callback ran, the compositor drew, the
   pixels changed some tens of milliseconds later. A panel typically adds one to three refresh
   intervals, and many add more.
2. **Camera latency.** The sensor integrated light over an exposure window, read the sensor
   out, the driver and the browser passed the frame along. Tens of milliseconds again.
3. **Processing latency.** Landmarks, crop, model, ridge. This one *is* visible — it is
   `frame.time.emit − frame.time.capture` — and it does not affect when the sample was taken,
   only when you learn about it.

Ignoring (1) and (2) is the standard practice, and it silently shifts every gaze sample by
something between 50 and 150 ms depending on the participant's hardware. For a two-second
free-viewing trial that is tolerable. For anything time-locked to a stimulus onset it is not,
and — worse — the error varies from participant to participant, so it does not even average out.

## What `t` is

```ts
interface FrameTime {
  capture: number;                                     // best available capture stamp
  source: "captureTime" | "receiveTime" | "callback";  // where it came from
  receive: number | null;
  presentedFrames: number | null;
  dropped: number | null;
  callback: number;   // when JavaScript received the frame
  emit: number;       // when the prediction became available
  meanCapture: number | null;  // mean capture time of the TTA ring buffer
}
```

`capture` comes from `VideoFrameCallbackMetadata.captureTime`, delivered by
`requestVideoFrameCallback` — the browser's own estimate of when the camera captured the frame,
already mapped onto the `performance.now()` timeline. If a browser does not supply it, the
tracker falls back to `receiveTime` and then to the callback time, and says which in `source`.
**Only `"captureTime"` supports a timing claim**; the other two are best-effort. Check
`saccade_timing.clock` before analysing latencies, and consider excluding participants whose
browser reported `"callback"`.

`meanCapture` is the one to use when test-time augmentation is on (it is by default, `tta: 5`).
The gaze estimate is computed from the mean of the last five embeddings, so it refers to the
mean of their capture times, not to the newest frame. The extension already uses `meanCapture`
when it is available.

`t` in `saccade_data` is then

```
t  =  meanCapture − trial_start_time − offset_ms
```

where `offset_ms` is the measured loopback lag if `saccade-time-sync` has run, and the
subtraction is skipped otherwise (`saccade_timing.corrected: false`).

## The loopback

`runLoopback()` — and the `saccade-time-sync` plugin that wraps it — measures delays (1) and (2)
*together*, as one number, using the only instrument every participant already has: their own
webcam pointed at their own screen.

For fifteen seconds the page steps between black and white. Each flip time is recorded from the
animation-frame callback; each camera frame's whole-frame luminance is sampled and stamped with
its `captureTime`. The lag is the shift that best aligns the two sequences, estimated from the
*edges* — the frame-to-frame luminance differences — rather than from levels, so it does not
care what fraction of the exposure window was lit.

Three design decisions are worth knowing about:

- **The schedule is sparse and random**, with gaps drawn uniformly between 500 and 1000 ms. This
  is not incidental. A fixed-rate schedule would land at the same phase of the camera's frame
  clock every time and bias the estimate by up to half a frame — display refresh and camera
  frame rate are very often an exact 2:1 ratio. It also means the screen changes at most twice a
  second, which is **not flicker**: it is far below any photosensitivity threshold, and it looks
  like a slow slideshow rather than a strobe. The instructions the plugin shows say exactly that.
- **The estimator returns a plateau, not a point.** Any lag within one camera frame period
  explains the data equally well, so the honest output is an interval. `lagMs` is its centre and
  `plateauWidthMs` its width; a plateau wider than 34 ms (one frame at 30 fps, plus slack) means
  something is wrong.
- **It reports a verdict.** `runLoopback` returns `verdict: "OK" | "INCONCLUSIVE" |
  "UNRELIABLE"` with a `reason`. The checks are: the edge-difference peak `peakD` must be at
  least 0.5, the plateau at most 34 ms, and the first and second halves of the run must agree —
  within 8 ms when there are at least 15 edges per half, within 20 ms otherwise. A bad
  measurement announces itself instead of quietly shifting your data.

## The hardware validation

The loopback is a claim about physics made from inside a browser, so it was checked from
outside one.

The rig is an RP2040 microcontroller with a **TEMT6000 photodiode** taped to the screen under a
black hood, and a **red LED** clipped to the bezel inside the webcam's field of view. The board
timestamps every photodiode edge on its own microsecond clock and fires the LED a programmable
delay after each edge, using an absolute-time hardware alarm so that main-loop latency cannot
shift the pulse. Sync pings before and after the run map the board's clock onto
`performance.now()`. The delay is randomised (100–140 ms) for the same anti-aliasing reason the
loopback's own schedule is sparse.

That gives an independent measurement of the same quantity: the browser says when it saw the
LED, the board says when it lit it, and the loopback correction should close the loop.

The subtle part was the statistic. "The first camera frame in which the LED appears" is on
average half a frame period *after* the LED came on, so a perfectly correct loopback still
produces a positive mean residual — about +12 ms, which was originally mistaken for a bias.
Comparing like with like means running the *same* plateau estimator on the LED pulses as on the
screen flips. Once that was done:

| Run | LED plateau | Loopback plateau | Difference | Pulses consistent |
| --- | --- | --- | --- | --- |
| Evening, good light | 77.8 ms | 78.0 ms | **−0.3 ms** | 51 / 54 |
| Earlier, dimmer | 98.0 ms | 95.0 ms | +3.0 ms | 53 / 63 |
| Earlier, dimmer | 87.0 ms | 95.0 ms | −8.0 ms | 53 / 62 |

**The browser-only loopback agrees with an external clock to under a millisecond on the best
run, and to a few milliseconds run to run** — which is the scatter you expect from a
minimum-type statistic. A webcam and a screen are enough; no hardware is required in the field.

The rig also answered two questions the loopback cannot:

- **Rolling shutter.** Running the same estimator on four horizontal bands of the stored frames
  gave 100 / 95 / 94 / 93 ms — about 9 ms of readout from top to bottom in one session and 3 ms
  in another, with the lower three bands within 2 ms of each other. Not a material bias.
- **Display latency is bimodal.** On the development panel, 42 ms (the next vsync) about 70% of
  the time and 59 ms (one refresh late) about 30%, mean 46–47 ms. This is where the residual
  jitter below comes from.

## What is left over

The loopback measures a specific convention: **the start of the camera's exposure window, on
the fastest display path**. Two things it deliberately does not resolve:

- **Half an exposure.** `captureTime` is stamped relative to the exposure window, but a
  webcam's exposure is set by the room's light — it lengthens in a dim room and shortens in a
  bright one — and it cannot be measured without external hardware. If you want the *middle* of
  the exposure rather than the start, add half of it. On the development camera that was
  roughly +14 ms; the plausible range is 0 to half a frame period, so **±17 ms at 30 fps**.
- **One refresh of display jitter.** The plateau lands on the fastest display path. An average
  flip is a few milliseconds slower than the fastest one (4 ms on the development panel, from
  the bimodality above), and any individual flip can be a whole refresh interval late.

So: **the residual uncertainty is half an exposure plus one refresh of display jitter**, or
roughly ±15–20 ms on typical consumer hardware, against a correction of 75–95 ms that would
otherwise be entirely unaccounted for. That is the honest bound, and it is stated rather than
hidden. Aligning to mid-exposure under mean display lag would add a constant of about +18 ms on
the development hardware, but since exposure cannot be measured on a participant's machine,
saccade.js does **not** apply it, and the loopback's plain lag is the recommended correction.

## Recommendations

**Run the loopback once per session, per participant.** The lag depends on the panel, the
camera, the driver, the browser and the room, so a value measured on your machine is not a
value for theirs. Fifteen seconds is a cheap price.

```js
timeline.push({ type: jsPsychSaccadeTimeSync });          // measure and apply
```

**Do not double-correct.** The loopback lag already contains the display latency. If you also
subtract a display latency measured some other way — or one from a specification sheet — you
will over-correct by that whole amount. Likewise do not subtract the processing latency: `t`
is a capture time, not an emit time, so processing is already excluded.

**Store the verdict and analyse it.** `saccade_timing.offset_ms`, `corrected`, `clock`,
`dropped_frames` and `fps` are recorded on every trial for a reason. Exclusion criteria worth
pre-registering:

```js
const bad = (d) =>
  !d.saccade_timing.corrected ||
  d.saccade_timing.clock !== "captureTime" ||
  d.saccade_timing.fps < 20 ||
  d.saccade_timing.dropped_frames > 0.05 * d.saccade_data.length;
```

**Keep `require_ok: false` unless you mean it.** An `UNRELIABLE` verdict usually means the
participant's window lost focus or something else was animating. The plugin can retry once, but
excluding people whose second attempt also fails is a decision about your sample, so make it
deliberately.

**Report the numbers.** A methods section that says "gaze samples were corrected by a
per-session screen-to-camera loopback measurement (median X ms, IQR Y), leaving a residual
uncertainty of half a camera exposure plus one display refresh" is a stronger claim than
anything the field has been able to make from a webcam before. The
[`saccade-time-sync` reference](../reference/plugin-time-sync) lists every field to report.

## Gaze-contingent designs

If you are changing the display *in response* to gaze, the relevant number is not `capture` but
`emit` — how stale the estimate is by the time you can act on it. That is
`frame.time.emit − frame.time.capture`, plus your own render, plus the display latency again on
the way out. Expect a closed loop of well over 100 ms, and note that test-time augmentation adds
about `(tta − 1) / 2` frames of lag to the estimate itself. For gaze-contingent work, set
`tta: 1` and accept the noisier estimate.
