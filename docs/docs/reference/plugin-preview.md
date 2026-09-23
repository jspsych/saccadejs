---
id: plugin-preview
title: saccade-preview
sidebar_label: saccade-preview
description: Start the camera, load the model, and let the participant position themselves.
---

# `saccade-preview`

The first saccade.js trial in any experiment. It:

1. asks the participant for permission to use their camera,
2. downloads the eye-tracking model (about 20 MB), with a progress bar,
3. shows the participant their camera image so they can get into a good position.

While positioning, the participant sees their mirrored camera image, a close-up of their eyes
exactly as the tracker sees them, and an indicator that reads **Face found** or **Looking for your
face…**. The **Continue** button enables once their face is found.

Put it early in the timeline. Every other saccade.js trial needs the camera to be running.

```js
timeline.push({ type: jsPsychSaccadePreview });
```

| | |
| --- | --- |
| Package | `@saccadejs/plugin-preview` |
| Browser global | `jsPsychSaccadePreview` |
| Trial type | `saccade-preview` |
| Requires | the [extension](extension) registered in `initJsPsych` |

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `instructions` | `HTML string` | advice on positioning | Text shown beside the camera image. |
| `button_text` | `string` | `"Continue"` | The label on the button that ends the trial. |
| `show_eye_crop` | `boolean` | `true` | Show the close-up of the eyes (the 144 × 36 pixel strip the model sees), enlarged. |
| `require_face` | `boolean` | `true` | Only enable the button while a face is being found. |
| `face_timeout` | `number \| null` | `null` | After this many milliseconds, enable the button even if no face has been found, so the participant is never stuck. `null` waits forever. |
| `preview_width` | `number` | `320` | Width of the camera image, in pixels. |
| `show_progress` | `boolean` | `true` | Show a progress bar and a label for each loading stage. `false` shows "Starting the camera…" instead. |
| `show_diagnostics` | `boolean` | `false` | Show the frame rate and whether the model is running on the graphics card (`webgpu`) or not (`wasm`) under the preview. Useful while piloting. Both are saved in the data either way. |

## Data

| Field | Type | Description |
| --- | --- | --- |
| `load_time` | `number` | Milliseconds from the start of the trial to the first camera frame. Includes the time the participant took to grant permission, the download, and start-up. |
| `face_detected` | `boolean` | Whether a face was being found when the participant pressed the button. `false` means they continued only because `face_timeout` ran out. |
| `fps` | `number` | Camera frames per second being processed at that moment. |
| `backend` | `"webgpu" \| "wasm"` | Whether the model is running on the graphics card (`"webgpu"`) or the slower processor path (`"wasm"`). See [Browser compatibility](../guides/browser-compatibility#webgpu-the-difference-that-matters-most). |
| `rt` | `number` | Milliseconds from the camera image appearing to the button press. |

## Example

```js
timeline.push({
  type: jsPsychSaccadePreview,
  instructions: `
    <h3>Camera setup</h3>
    <p>Face the screen, with light on your face rather than behind you. When your eyes
    appear clearly in the strip below, press continue.</p>
    <p>Nothing is recorded or uploaded. The video stays on your computer.</p>`,
  button_text: "My eyes are visible",
  face_timeout: 30000, // let them continue after 30 seconds regardless
  preview_width: 400,
});
```

## The loading screen

Before the camera image appears, the trial shows a progress bar that steps through each part of
loading, in order: camera permission, MediaPipe (the face finder's software), the face finder
model, onnxruntime-web (the eye model's software), the eye model, and a warm-up run. Only the eye
model download reports its size, so it is the only stage where the bar moves smoothly, for example
`Downloading eye model 12.3 / 20.6 MB`. The other stages move the bar forward as each one finishes.

The progress comes from the extension's `onSetupProgress`, if you want to build your own loading
screen.

## Troubleshooting

If `backend` is `"wasm"` on a computer that should support WebGPU, one possible cause is a wrong
asset URL. See [Hosting the assets](../guides/hosting-the-assets).
