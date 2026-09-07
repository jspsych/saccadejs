# @saccadejs/plugin-performance

A [jsPsych](https://www.jspsych.org) plugin that measures how fast
[saccade.js](https://github.com/jspsych/saccadejs) actually runs on a participant's machine, and
optionally excludes machines that are too slow for the study.

WebGPU is what gets the tracker to full speed. When it is unavailable — or the driver refuses the
session, or an asset URL is wrong — saccade.js falls back to WebAssembly and keeps going, more
slowly, without saying anything. This plugin is how you find out, in numbers, before the data
collection depends on it.

Its exclusion machinery is
[`browser-check`](https://www.jspsych.org/latest/plugins/browser-check/)'s: an
`inclusion_function` over the measured data, an `exclusion_message` built from that same data,
and an experiment that ends there when the two disagree.

Requires the [`@saccadejs/extension`](../extension-saccadejs) extension to be registered in
`initJsPsych`, and the tracker to be running — put this trial after
[`saccade-preview`](../plugin-saccadejs-preview).

## Installation

```
npm install @saccadejs/core @saccadejs/extension @saccadejs/plugin-performance
```

## Usage

Put it after the preview trial and before calibration, so a participant who is going to be
excluded is not first made to sit through thirteen calibration points.

```html
<script src="https://unpkg.com/jspsych@8"></script>
<script src="https://unpkg.com/@saccadejs/core"></script>
<script src="https://unpkg.com/@saccadejs/extension"></script>
<script src="https://unpkg.com/@saccadejs/plugin-preview"></script>
<script src="https://unpkg.com/@saccadejs/plugin-performance"></script>
<script>
  const jsPsych = initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] });

  jsPsych.run([
    { type: jsPsychSaccadePreview },
    {
      type: jsPsychSaccadePerformance,
      inclusion_function: (data) => data.fps_median >= 15,
      exclusion_message: (data) =>
        data.backend === "wasm"
          ? `<p>This browser could not use your graphics card for the eye tracker, so it runs
             too slowly for this study.</p>`
          : `<p>The eye tracker runs at ${data.fps_median?.toFixed(0) ?? "under 1"} fps on this
             computer, which is below the 15 fps this study needs.</p>`,
    },
    { type: jsPsychSaccadeCalibrate },
  ]);
</script>
```

Leave `inclusion_function` out and the trial excludes nobody: it measures, records, and moves on.
That is the right starting point while piloting — collect the numbers first, and decide what
threshold they justify once you know what your participants' machines look like.

## Parameters

| Parameter              | Type     | Default          | Description                                                                                                                                                            |
| ---------------------- | -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stimulus`             | HTML     | _a fixation dot_ | What to show while the measurement runs. A face has to be in view for a frame to reach the model, so the default asks the participant to look at a dot and hold still. |
| `measurement_duration` | integer  | `5000`           | How long, in ms, to measure for once the warm-up has passed.                                                                                                           |
| `warmup_duration`      | integer  | `1000`           | How long, in ms, to discard before measuring.                                                                                                                          |
| `inclusion_function`   | function | `() => true`     | Receives the measured data; return `true` to include this participant.                                                                                                 |
| `exclusion_message`    | function | _see below_      | Receives the measured data; returns the HTML shown when `inclusion_function` returns `false`.                                                                          |

## Data generated

| Name                  | Type    | Description                                                                                                                               |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `fps_median`          | float   | The median frame rate over the window, in Hz. **The headline number.** `null` if no two consecutive frames with a face in them were seen. |
| `fps_mean`            | float   | Frames per second averaged over the whole window — what `frames / duration` would give.                                                   |
| `fps_p10`             | float   | The rate at the slow end: the 10th percentile of frame rate, i.e. the 90th percentile of the interval between frames.                     |
| `frames`              | integer | Frames with a face in them during the window — the frames the rates are computed from.                                                    |
| `frames_without_face` | integer | Frames in the window with no face in them.                                                                                                |
| `dropped`             | integer | Camera frames presented but never processed, as reported by `requestVideoFrameCallback`. How far behind the camera the tracker fell.      |
| `embed_ms_median`     | float   | Median time in ms spent in the model for one frame.                                                                                       |
| `backend`             | string  | The execution provider the model is running on: `"webgpu"` or `"wasm"`.                                                                   |
| `rt`                  | integer | Time in ms from the start of the trial until the measurement finished.                                                                    |

## Interpreting the numbers

**`fps_median` is the number to gate on.** It is the rate the experiment will actually run at:
saccade.js keeps exactly one inference in flight and asks for the next camera frame only after
the current one has been through the model, so the frame rate is bounded by whichever of camera
delivery or inference is slower, and it is also the rate at which gaze samples land in your data.

**Pick the threshold from your design, not from a rule of thumb.** A ten-second free-viewing
preference measure is fine at a few frames per second. Anything that depends on _when_ a look
happened — saccade latency, gaze-contingent displays, time-locking to a stimulus onset — is not.
Sampling at _f_ Hz puts a floor of roughly `1000 / f` ms on how precisely any event can be
placed, before any of the other error sources.

**`fps_p10` catches what the median hides.** A machine that stalls periodically — thermal
throttling, a busy background tab, another program waking up — can have a perfectly healthy
median and a fifth of its samples arriving far too late. The p10 only moves when the slow frames
are at least a tenth of them, so an isolated hiccup will not fail anyone.

**`embed_ms_median` says whose fault a low rate is.** A low `fps_median` with a small
`embed_ms_median` is a camera that is not delivering frames any faster, and no amount of GPU will
help. A large `embed_ms_median` is the model, and usually means `backend` is `"wasm"`.

**`backend: "wasm"` on a machine that should have WebGPU usually means an asset URL is wrong**
rather than a machine that cannot do it — see
[Hosting the assets](https://saccade.jspsych.org/guides/hosting-the-assets/).

**A machine that could not be measured has `fps_median: null`.** `null >= 15` is `false`, so the
obvious comparison in an `inclusion_function` excludes it without any extra work, which is what
you want: a participant whose frame rate is unknown is not one who passed.

**Frames with no face in them are excluded from the rates.** They never reach the model at all,
so counting them would report a rate the machine cannot sustain once it is actually tracking.
They are reported separately as `frames_without_face`; a large number there means the participant
was out of frame and the measurement covers less time than it looks.

## License

MIT
