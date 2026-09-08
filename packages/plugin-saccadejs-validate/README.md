# @saccadejs/plugin-validate

A [jsPsych](https://www.jspsych.org) plugin that measures how good the current
[saccade.js](https://github.com/jspsych/saccadejs) calibration actually is. It shows a grid of
targets — the same ring-and-dot animation as
[`saccade-calibrate`](../plugin-saccadejs-calibrate) — and compares the gaze predictions with
where the participant was asked to look.

It reports the error at each point, the proportion of samples that landed inside a region of
interest around it, and two summary numbers for the trial as a whole (`median_error_px`,
`median_error_viewport`).

Requires the [`@saccadejs/extension`](../extension-saccadejs) extension to be registered in
`initJsPsych`, and the tracker to be calibrated.

## Installation

```
npm install @saccadejs/core @saccadejs/extension @saccadejs/plugin-validate
```

## Usage

```html
<script src="https://unpkg.com/jspsych@8"></script>
<script src="https://unpkg.com/@saccadejs/core"></script>
<script src="https://unpkg.com/@saccadejs/extension"></script>
<script src="https://unpkg.com/@saccadejs/plugin-preview"></script>
<script src="https://unpkg.com/@saccadejs/plugin-calibrate"></script>
<script src="https://unpkg.com/@saccadejs/plugin-validate"></script>
<script>
  const jsPsych = initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] });

  jsPsych.run([
    { type: jsPsychSaccadePreview },
    { type: jsPsychSaccadeCalibrate },
    {
      type: jsPsychSaccadeValidate,
      roi_radius: 200,
      on_finish: (data) => {
        // recalibrate if the fit is poor
        data.recalibrate = data.median_error_px > 200;
      },
    },
  ]);
</script>
```

## Parameters

| Parameter                      | Type                                  | Default        | Description                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validation_points`            | array of `[x, y]`                     | _9-point grid_ | Targets, interpreted per `validation_point_coordinates`. The default is the core's `validationGrid9()`: a 3×3 grid at 15/50/85 %, pulled in from the calibration extremes so validation is not just a re-test of the calibration targets. |
| `validation_point_coordinates` | `"percent"`\|`"center-offset-pixels"` | `"percent"`    | Whether the points are percentages of the viewport, or pixel offsets from its center.                                                                                                                                                     |
| `roi_radius`                   | integer                               | `200`          | Radius in pixels of the region of interest around each point; samples inside it count toward `percent_in_roi`.                                                                                                                            |
| `randomize_validation_order`   | boolean                               | `false`        | Shuffle the order of the points.                                                                                                                                                                                                          |
| `time_to_saccade`              | integer                               | `1000`         | Settle time in ms before gaze is recorded at each point.                                                                                                                                                                                  |
| `validation_duration`          | integer                               | `2000`         | How long in ms to record gaze at each point.                                                                                                                                                                                              |
| `point_size`                   | integer                               | `20`           | Diameter of the dot in pixels.                                                                                                                                                                                                            |
| `show_validation_data`         | boolean                               | `false`        | Show a scatter of the raw samples with the ROI circles when validation finishes, and wait for a click. For piloting, not for a real experiment.                                                                                           |

## Data generated

| Name                    | Type    | Description                                                                                                                                                                                                                 |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raw_gaze`              | array   | One nested array per validation point, in presentation order. Each entry is `{x, y, dx, dy, t}`: gaze in viewport pixels, its offset from the target in pixels, and the time in ms since the start of the trial.            |
| `percent_in_roi`        | array   | For each point, the percentage of samples that fell within `roi_radius` of it (0–100).                                                                                                                                      |
| `average_offset`        | array   | For each point, `{x, y, r}` — the average offset of gaze from the target (accuracy) and the median distance of individual samples from that average (precision). `{x: null, y: null, r: null}` for a point with no samples. |
| `samples_per_sec`       | float   | Mean sampling rate over the points. `null` if no point collected two samples.                                                                                                                                               |
| `validation_points`     | array   | The points, in the order they were shown.                                                                                                                                                                                   |
| `median_error_px`       | float   | Median across points of the distance in pixels between the target and the average gaze for that target. **The headline accuracy number.** `null` if no point collected any samples.                                         |
| `median_error_viewport` | float   | The same error in viewport units (x divided by viewport width, y by height) — comparable across screen sizes, and the unit the model was evaluated in.                                                                      |
| `rt`                    | integer | Time from the start of the trial until validation finished.                                                                                                                                                                 |

## Interpreting the numbers

`median_error_px` is accuracy: how far the average prediction sits from where the participant was
actually looking. `average_offset[i].r` is precision: how scattered the samples are around their
own average. A large `r` with a small offset means a noisy but unbiased estimate — more smoothing
(the extension's `smoothing_frames`) will help. A small `r` with a large offset means a systematic bias — a
recalibration will help.

`median_error_viewport` is the number to compare against published model evaluations, which report
error in viewport units rather than pixels.

## License

MIT
