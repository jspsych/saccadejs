# @saccadejs/plugin-preview

A [jsPsych](https://www.jspsych.org) plugin that starts the [saccade.js](https://github.com/jspsych/saccadejs)
camera and lets the participant position themselves in front of it.

The trial shows the mirrored camera image, the 144×36 eye crop that the model actually sees
(scaled up), an indicator that reads "Face found" or "Looking for your face…", and a continue
button that stays disabled until the tracker is running and a face is being found. Because it is
the first trial that touches the camera, it is also where the browser's camera-permission prompt
appears and where the ONNX model and MediaPipe wasm are downloaded — so it opens on a progress bar
with a plain-language label (`Downloading the eye tracker (12.3 of 20.6 MB)…` for the ~20 MB
model, the only stage that can report bytes). Set `show_progress: false` for a plain "Starting the
camera…" message.

Under the indicator, two lines advise the participant on their distance from the camera and their
lighting. They come from two measures that predicted tracking accuracy in the saccade.js
validation study: the distance between the eyes as a share of the image's width (sitting nearer
is better) and the contrast of the raw eye region (more is better). Each is averaged over about a third of a second; the advice never disables the button, and the measures are recorded in the data whether
or not it is shown.

Everything on screen is worded for participants. The frame rate and the execution provider are
recorded in the data either way; set `show_diagnostics: true` to show them under the preview
while piloting.

Requires the [`@saccadejs/extension`](../extension-saccadejs) extension to be registered in
`initJsPsych`.

## Installation

```
npm install @saccadejs/core @saccadejs/extension @saccadejs/plugin-preview
```

## Usage

```html
<script src="https://unpkg.com/jspsych@8"></script>
<script src="https://unpkg.com/@saccadejs/core"></script>
<script src="https://unpkg.com/@saccadejs/extension"></script>
<script src="https://unpkg.com/@saccadejs/plugin-preview"></script>
<script>
  const jsPsych = initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] });

  jsPsych.run([
    {
      type: jsPsychSaccadePreview,
      instructions: "<p>Center your face in the preview and look at the screen.</p>",
    },
  ]);
</script>
```

## Parameters

| Parameter                  | Type        | Default                      | Description                                                                                                                                                                                                                                  |
| -------------------------- | ----------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions`             | HTML string | _(positioning instructions)_ | Instructions shown beside the camera preview.                                                                                                                                                                                                |
| `button_text`              | string      | `"Continue"`                 | Text of the button that ends the trial.                                                                                                                                                                                                      |
| `show_eye_crop`            | boolean     | `true`                       | Show the 144×36 eye crop the model sees, scaled up to `preview_width`. Very useful for spotting a bad crop early.                                                                                                                            |
| `require_face`             | boolean     | `true`                       | Enable the continue button only while a face is being found.                                                                                                                                                                                 |
| `face_timeout`             | integer     | `null`                       | Escape hatch for `require_face`: after this many ms the button is enabled even if no face has ever been found, so a participant the model cannot cope with is not stuck. `null` waits indefinitely; `face_detected` still records the truth. |
| `preview_width`            | integer     | `320`                        | Width of the camera preview, in pixels.                                                                                                                                                                                                      |
| `show_progress`            | boolean     | `true`                       | Show a progress bar and a stage label while the camera, MediaPipe, the face landmarker, onnxruntime-web and the eye model load, instead of a plain "Starting the camera…" message.                                                           |
| `show_setup_feedback`      | boolean     | `true`                       | Show the distance and lighting advice under the preview. Advice only; it never disables the button.                                                                                                                                          |
| `min_interocular_distance` | float       | `0.14`                       | Below this interocular distance (outer eye corners, share of the image's width) the participant is asked to move closer. About the 10th percentile of the training participants.                                                             |
| `max_interocular_distance` | float       | `0.32`                       | Above this the participant is asked to move back. About the 99th percentile.                                                                                                                                                                 |
| `min_eye_contrast`         | float       | `17`                         | Below this eye contrast (SD of the raw eye region's gray levels, 0–255) the participant is asked to improve their lighting. About the 10th percentile.                                                                                       |
| `show_diagnostics`         | boolean     | `false`                      | Show the tracker's frame rate and the execution provider (`webgpu` or `wasm`) under the preview. For piloting; both are recorded in the data either way.                                                                                     |

## Data generated

| Name                   | Type    | Description                                                                                                                             |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `load_time`            | integer | How long (ms) it took to get the camera and the models running. Long on a slow connection; recorded for troubleshooting.                |
| `face_detected`        | boolean | Whether a face was being found at the moment the participant continued.                                                                 |
| `fps`                  | float   | The tracker's frame rate when the participant continued.                                                                                |
| `backend`              | string  | The ONNX Runtime execution provider in use: `"webgpu"` or `"wasm"`. `wasm` is much slower.                                              |
| `interocular_distance` | float   | Outer-eye-corner distance as a share of the image's width, averaged over about the last third of a second. `null` if no face was found. |
| `eye_contrast`         | float   | SD of the raw eye region's gray levels (0–255), averaged the same way.                                                                  |
| `eye_brightness`       | float   | Mean gray level of the raw eye region (0–255), averaged the same way.                                                                   |
| `distance_feedback`    | string  | `"good"`, `"closer"` or `"farther"` when the participant continued; `null` if no face was found.                                        |
| `lighting_feedback`    | string  | `"good"`, `"dark"`, `"bright"` or `"flat"` when the participant continued; `null` if no face was found.                                 |
| `rt`                   | integer | Time from the start of the trial until the button was clicked.                                                                          |

If the camera cannot be started (permission denied, no camera, WebGPU and wasm both unavailable),
the trial shows an explanation and the underlying error message, and does not continue: there is
nothing useful to record without a camera.

## License

MIT
