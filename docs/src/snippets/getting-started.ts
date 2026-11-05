// The two HTML listings on Getting started. They live here rather than in the MDX so the
// `<script>` tags can pin each package to its current version (see ../versions.ts).
import { versions } from "../versions";

const scripts = `    <script src="https://unpkg.com/jspsych@8"></script>
    <script src="https://unpkg.com/@jspsych/plugin-html-keyboard-response@2"></script>
    <script src="https://unpkg.com/@saccadejs/core@${versions.core}"></script>
    <script src="https://unpkg.com/@saccadejs/extension@${versions.extension}"></script>
    <script src="https://unpkg.com/@saccadejs/plugin-preview@${versions.preview}"></script>
    <script src="https://unpkg.com/@saccadejs/plugin-time-sync@${versions.timeSync}"></script>
    <script src="https://unpkg.com/@saccadejs/plugin-calibrate@${versions.calibrate}"></script>
    <script src="https://unpkg.com/@saccadejs/plugin-validate@${versions.validate}"></script>
    <link rel="stylesheet" href="https://unpkg.com/jspsych@8/css/jspsych.css" />`;

export const headSnippet = `<!doctype html>
<html>
  <head>
${scripts}
  </head>
  <body></body>
</html>`;

export const wholeFile = `<!doctype html>
<html>
  <head>
${scripts}
  </head>
  <body></body>
  <script>
    const jsPsych = initJsPsych({
      extensions: [{ type: jsPsychExtensionSaccade }],
      on_finish: () => jsPsych.data.displayData(),
    });

    const timeline = [
      // Ask for the camera, download the model, and let the participant line up their face.
      { type: jsPsychSaccadePreview },
      // Measure this computer's screen-to-camera delay, so later timestamps can be corrected.
      { type: jsPsychSaccadeTimeSync },
      // Calibrate on 13 dots, then check accuracy on 9 different dots.
      { type: jsPsychSaccadeCalibrate },
      { type: jsPsychSaccadeValidate },
      // The task. The \`extensions\` line is what turns gaze recording on for this trial.
      {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: \`
          <div style="display:flex; gap:20vw; justify-content:center">
            <img id="left" src="left.png" width="300" />
            <img id="right" src="right.png" width="300" />
          </div>
          <p>Look at whichever picture you prefer, then press any key.</p>\`,
        extensions: [
          { type: jsPsychExtensionSaccade, params: { targets: ["#left", "#right"] } },
        ],
      },
    ];

    jsPsych.run(timeline);
  </script>
</html>`;
