# @saccadejs/plugin-preview

A [jsPsych](https://www.jspsych.org) plugin that starts the [saccade.js](https://github.com/jspsych/saccadejs)
camera and lets the participant position themselves in front of it. It is the saccade.js
replacement for `webgazer-init-camera`.

The trial shows the mirrored camera image, the 144×36 eye crop that the model actually sees
(scaled up), a face-found indicator and the frame rate, and a continue button that stays disabled
until a face is being found. Because it is the first trial that touches the camera, it is also
where the browser's camera-permission prompt appears and where the ONNX model and MediaPipe wasm
are downloaded.

Requires the [`@saccadejs/extension`](../extension-saccadejs) extension to be registered in
`initJsPsych`.

## Installation

```
npm install saccadejs @saccadejs/extension @saccadejs/plugin-preview
```

## Usage

```html
<script src="https://unpkg.com/jspsych@8"></script>
<script src="https://unpkg.com/saccadejs"></script>
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

| Parameter       | Type        | Default                      | Description                                                                                                                                                                                                                                  |
| --------------- | ----------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions`  | HTML string | _(positioning instructions)_ | Instructions shown beside the camera preview.                                                                                                                                                                                                |
| `button_text`   | string      | `"Continue"`                 | Text of the button that ends the trial.                                                                                                                                                                                                      |
| `show_eye_crop` | boolean     | `true`                       | Show the 144×36 eye crop the model sees, scaled up to `preview_width`. Very useful for spotting a bad crop early.                                                                                                                            |
| `require_face`  | boolean     | `true`                       | Enable the continue button only while a face is being found.                                                                                                                                                                                 |
| `face_timeout`  | integer     | `null`                       | Escape hatch for `require_face`: after this many ms the button is enabled even if no face has ever been found, so a participant the model cannot cope with is not stuck. `null` waits indefinitely; `face_detected` still records the truth. |
| `preview_width` | integer     | `320`                        | Width of the camera preview, in pixels.                                                                                                                                                                                                      |

## Data generated

| Name            | Type    | Description                                                                                                              |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `load_time`     | integer | How long (ms) it took to get the camera and the models running. Long on a slow connection; recorded for troubleshooting. |
| `face_detected` | boolean | Whether a face was being found at the moment the participant continued.                                                  |
| `fps`           | float   | The tracker's frame rate when the participant continued.                                                                 |
| `backend`       | string  | The ONNX Runtime execution provider in use: `"webgpu"` or `"wasm"`. `wasm` is much slower.                               |
| `rt`            | integer | Time from the start of the trial until the button was clicked.                                                           |

If the camera cannot be started (permission denied, no camera, WebGPU and wasm both unavailable),
the trial shows an explanation and does not continue — the same dead end `webgazer-init-camera`
uses, since there is nothing useful to record without a camera.

## License

MIT
