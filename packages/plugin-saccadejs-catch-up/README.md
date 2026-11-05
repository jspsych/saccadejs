# @saccadejs/plugin-catch-up

A [jsPsych](https://www.jspsych.org) plugin for [saccade.js](https://github.com/jspsych/saccadejs)
deferred mode. It waits for the background workers to finish embedding the frames that recording
trials queued, so every trial's `saccade_data` is complete, and shows the participant a progress
bar while they do.

In deferred mode, on computers too slow to run the model on every frame as it arrives, recording
trials end before their gaze has been computed. Run this trial before the data is saved. In live
mode it ends immediately, so an experiment can include it unconditionally.

Requires the [`@saccadejs/extension`](../extension-saccadejs) extension to be registered in
`initJsPsych`.

## Installation

```
npm install @saccadejs/core @saccadejs/extension @saccadejs/plugin-catch-up
```

## Usage

```js
const jsPsych = initJsPsych({
  extensions: [{ type: jsPsychExtensionSaccade, params: { mode: "auto" } }],
});

timeline.push({ type: jsPsychSaccadePreview });
timeline.push({ type: jsPsychSaccadeCalibrate });
// ... trials that record gaze ...
timeline.push({ type: jsPsychSaccadeCatchUp });
// ... then save the data
```

## Parameters

| Parameter                | Type        | Default                                       | Description                                                                                                                                                                                                          |
| ------------------------ | ----------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`                | HTML string | "Finishing up. Please keep this window open." | Shown while waiting.                                                                                                                                                                                                 |
| `max_wait`               | integer     | `null`                                        | The longest to wait, in ms. `null` waits until every frame is embedded. Frames still queued when it runs out are given up on.                                                                                        |
| `save_unprocessed_crops` | boolean     | `false`                                       | Save the eye crops of frames given up on at `max_wait` in their trials' `saccade_deferred.crops`, for offline processing, instead of discarding them. The crops are recognisable pictures of the participant's eyes. |
| `pause_tracking`         | boolean     | `true`                                        | Pause the frame loop while waiting, so the workers get the whole processor.                                                                                                                                          |
| `show_progress`          | boolean     | `true`                                        | Show a progress bar and an estimate of the time left.                                                                                                                                                                |

## Data generated

| Name             | Type    | Description                                                                  |
| ---------------- | ------- | ---------------------------------------------------------------------------- |
| `mode`           | string  | `"live"` or `"deferred"`.                                                    |
| `frames_waiting` | integer | Frames still queued or being embedded when the trial started.                |
| `frames_lost`    | integer | Frames never embedded: given up on at `max_wait`, or lost from a full queue. |
| `timed_out`      | boolean | Whether `max_wait` ran out.                                                  |
| `crops_saved`    | integer | Lost frames whose crops were saved.                                          |
| `wait_ms`        | integer | How long the participant waited, in ms.                                      |

See [Slow computers and deferred mode](https://saccade.jspsych.org/guides/deferred-mode/) and the
[reference page](https://saccade.jspsych.org/reference/plugin-catch-up/).

## License

MIT
