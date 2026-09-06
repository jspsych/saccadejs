---
id: plugin-preview
title: saccade-preview
sidebar_label: saccade-preview
description: Start the camera, load the model, and let the participant position themselves.
---

# `saccade-preview`

Starts the camera, loads the model, and shows the participant what the tracker actually sees so
they can position themselves before anything is measured.

| | |
| --- | --- |
| Package | `@saccadejs/plugin-preview` |
| Browser global | `jsPsychSaccadePreview` |
| Trial type | `saccade-preview` |
| Replaces | `@jspsych/plugin-webgazer-init-camera` |

Requires the [extension](extension) to be registered in `initJsPsych`.

```js
timeline.push({ type: jsPsychSaccadePreview });
```

## What it does

Calls `extension.start()`, which prompts for the camera and downloads the model — about 20 MB,
so a progress line is shown while it happens. Once frames are arriving it displays:

- the **mirrored camera preview**, so the participant can centre themselves;
- beside it, the **144 × 36 eye crop scaled up** — the model's actual input, which makes
  lighting and framing problems immediately visible in a way a face box does not;
- a **face-found indicator**;
- the current **frame rate and backend** (`webgpu` or `wasm`).

With `require_face: true` the continue button is enabled only while a face is being found, so
nobody proceeds to calibration with the camera pointed at the ceiling. `face_timeout` is the
escape hatch: after that many milliseconds the button enables anyway, and the trial records
`face_detected: false` so the participant can be excluded later rather than stranded now.

This is where the model download happens, so put it early. Everything after it is fast.

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `instructions` | `HTML string` | A default explaining positioning | Shown above the preview. Replace it to add your own consent or lighting advice. |
| `button_text` | `string` | `"Continue"` | |
| `show_eye_crop` | `boolean` | `true` | Show the scaled-up eye crop beside the preview. |
| `require_face` | `boolean` | `true` | Enable the button only while a face is found. |
| `face_timeout` | `number \| null` | `null` | Milliseconds after which the button enables anyway, even though no face has been found. `null` means never — a participant whose camera never sees a face cannot continue. Set it if you would rather let someone through and exclude them in analysis (their `face_detected` will be `false`) than lose them at setup. |
| `preview_width` | `number` | `320` | Width of the camera preview, in pixels. |

## Data

| Field | Type | Description |
| --- | --- | --- |
| `load_time` | `number` | Milliseconds from trial start to the first camera frame — camera permission plus model download plus warm-up. Worth looking at across participants; a long tail here is an asset-hosting problem. |
| `face_detected` | `boolean` | Whether a face was found at the moment the participant continued. `false` here means they got through on a `face_timeout`, and is worth an exclusion rule. |
| `fps` | `number` | Frame rate at that moment. |
| `backend` | `"webgpu" \| "wasm"` | Which execution provider loaded. |
| `rt` | `number` | Response time, as for every plugin. |

## Example

```js
timeline.push({
  type: jsPsychSaccadePreview,
  instructions: `
    <h3>Camera setup</h3>
    <p>Sit about an arm's length from the screen, with light on your face rather than
    behind you. When your eyes appear clearly in the strip below, press continue.</p>
    <p>Nothing is recorded or uploaded — the video stays on your computer.</p>`,
  button_text: "My eyes are visible",
  preview_width: 400,
});
```

## Notes

- **The preview is mirrored; the pixels the model sees are not.** That is deliberate — a
  mirrored preview is what people can position themselves with, and a mirrored crop would
  produce a left–right inverted gaze estimate.
- **The camera prompt.** Browsers require a user gesture and a secure context. Because the
  prompt appears when this trial starts, keep the trial before it short and explanatory: a
  permission dialog with no context on screen behind it is the most common point of dropout in
  a webcam experiment.
- **`backend: "wasm"` on a capable machine** usually means an asset URL is wrong rather than
  that WebGPU is missing. See [Hosting the assets](../guides/hosting-the-assets).
