---
id: plugin-preview
title: saccade-preview
sidebar_label: saccade-preview
description: Start the camera, load the model, and let the participant position themselves.
---

# `saccade-preview`

Prompts for the camera, downloads the model, and shows the participant the mirrored camera
image, the eye crop the model sees, a face-found indicator and the current frame rate. Put it
early in the timeline: this is where the download happens.

| | |
| --- | --- |
| Package | `@saccadejs/plugin-preview` |
| Browser global | `jsPsychSaccadePreview` |
| Trial type | `saccade-preview` |
| Requires | the [extension](extension) registered in `initJsPsych` |

```js
timeline.push({ type: jsPsychSaccadePreview });
```

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `instructions` | `HTML string` | positioning advice | Shown beside the preview. |
| `button_text` | `string` | `"Continue"` | Text of the button that ends the trial. |
| `show_eye_crop` | `boolean` | `true` | Show the 144 × 36 eye crop the model sees, scaled up. |
| `require_face` | `boolean` | `true` | Enable the continue button only while a face is being found. |
| `face_timeout` | `number \| null` | `null` | Milliseconds after which the button enables even if no face has been found. `null` waits indefinitely. |
| `preview_width` | `number` | `320` | Width of the camera preview, in pixels. |

## Data

| Field | Type | Description |
| --- | --- | --- |
| `load_time` | `number` | Milliseconds from trial start to the first camera frame: permission, download and warm-up. |
| `face_detected` | `boolean` | Whether a face was being found when the participant continued. `false` means they got through on a `face_timeout`. |
| `fps` | `number` | Frame rate at that moment. |
| `backend` | `"webgpu" \| "wasm"` | The execution provider that loaded. |
| `rt` | `number` | Milliseconds from the preview appearing to the button click. |

## Example

```js
timeline.push({
  type: jsPsychSaccadePreview,
  instructions: `
    <h3>Camera setup</h3>
    <p>Sit about an arm's length from the screen, with light on your face rather than
    behind you. When your eyes appear clearly in the strip below, press continue.</p>
    <p>Nothing is recorded or uploaded. The video stays on your computer.</p>`,
  button_text: "My eyes are visible",
  face_timeout: 30000,
  preview_width: 400,
});
```

`backend: "wasm"` on a machine that should have WebGPU usually means an asset URL is wrong. See
[Hosting the assets](../guides/hosting-the-assets).
