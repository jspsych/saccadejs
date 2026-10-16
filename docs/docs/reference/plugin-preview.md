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

Under the indicator, two lines of advice tell the participant whether they are close enough to the
camera and whether their eyes are lit well enough (see [Distance and lighting
feedback](#distance-and-lighting-feedback)).

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
| `show_setup_feedback` | `boolean` | `true` | Show the distance and lighting advice under the camera image. It is advice only and never disables the button. The measures are saved in the data either way. |
| `min_interocular_distance` | `number` | `0.14` | Below this distance between the eyes (as a share of the camera image's width), ask the participant to move closer. |
| `max_interocular_distance` | `number` | `0.32` | Above this, ask the participant to move back. |
| `min_eye_contrast` | `number` | `17` | Below this contrast in the eye region (the standard deviation of its gray levels, 0–255), ask the participant to improve their lighting. |
| `show_diagnostics` | `boolean` | `false` | Show the frame rate and whether the model is running on the graphics card (`webgpu`) or not (`wasm`) under the preview. Useful while piloting. Both are saved in the data either way. |

## Data

| Field | Type | Description |
| --- | --- | --- |
| `load_time` | `number` | Milliseconds from the start of the trial to the first camera frame. Includes the time the participant took to grant permission, the download, and start-up. |
| `face_detected` | `boolean` | Whether a face was being found when the participant pressed the button. `false` means they continued only because `face_timeout` ran out. |
| `fps` | `number` | Camera frames per second being processed at that moment. |
| `backend` | `"webgpu" \| "wasm"` | Whether the model is running on the graphics card (`"webgpu"`) or the slower processor path (`"wasm"`). See [Browser compatibility](../guides/browser-compatibility#webgpu-the-difference-that-matters-most). |
| `interocular_distance` | `number \| null` | Distance between the outer corners of the eyes, as a share of the camera image's width, averaged over about the last third of a second before the button press. Larger means nearer the camera. `null` if no face was ever found. |
| `eye_contrast` | `number \| null` | Contrast of the eye region, 0–255, averaged the same way. |
| `eye_brightness` | `number \| null` | Mean brightness of the eye region, 0–255, averaged the same way. |
| `distance_feedback` | `string \| null` | The distance advice at the button press: `"good"`, `"closer"` or `"farther"`. |
| `lighting_feedback` | `string \| null` | The lighting advice at the button press: `"good"`, `"dark"`, `"bright"` or `"flat"`. |
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

## Distance and lighting feedback

In the saccade.js validation study, two things about the camera image predicted how accurately a
participant was tracked: how far apart their eyes were in the image, which is mostly how near
they sat to the camera, and how much contrast their eye images had, which is mostly lighting and
camera quality. Participants who sat farther away or whose eyes had less contrast were tracked
less accurately. The preview measures both on every frame, the same way the study did, and
turns them into advice:

| Line | Advice | When |
| --- | --- | --- |
| Distance | good | between `min_interocular_distance` and `max_interocular_distance` |
| | move a little closer to the camera | below `min_interocular_distance` |
| | move back a little | above `max_interocular_distance` |
| Lighting | good | contrast at or above `min_eye_contrast` |
| | too dark | low contrast, and the eyes are dark |
| | too bright | low contrast, and the eyes are washed out |
| | your eyes are hard to make out | low contrast at an ordinary brightness |

The default thresholds are about the 10th percentile of the 2,000 participants the model was
trained on (and the 99th for being too near), so most people see "good" on both lines without
changing anything. Each measure is averaged over about the last third of a second, and a
warning needs the reading to come back a little past its threshold before it clears, so the
advice does not flicker.

The interocular distance is a share of the image's width, so it depends on the camera's field of
view as well as on distance. A participant with a wide-angle camera may be asked to move closer
than they would with a narrow one. That is the right advice: what matters to the model is how
much of the image the eyes fill.

Because the measures are saved whatever is shown, you can also use them as covariates, or to
exclude participants, in your analysis.

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
