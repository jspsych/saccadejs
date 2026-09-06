# @saccadejs/plugin-calibrate

A [jsPsych](https://www.jspsych.org) plugin that calibrates
[saccade.js](https://github.com/jspsych/saccadejs): it shows a sequence of targets, collects eye
embeddings while the participant looks at each one, and fits the per-participant ridge regression
that turns those embeddings into gaze.

Each target is a white dot inside a ring on a masked full-viewport background. The ring shrinks
onto the dot while the participant settles (`time_to_saccade`), then turns green while embeddings
are captured (`time_per_point`), so the participant can see exactly when it matters that they are
looking at the dot.

Requires the [`@saccadejs/extension`](../extension-saccadejs) extension to be registered in
`initJsPsych`, and the camera to be running (put a
[`saccade-preview`](../plugin-saccadejs-preview) trial before it).

## Installation

```
npm install saccadejs @saccadejs/extension @saccadejs/plugin-calibrate
```

## Usage

```html
<script src="https://unpkg.com/jspsych@8"></script>
<script src="https://unpkg.com/saccadejs"></script>
<script src="https://unpkg.com/@saccadejs/extension"></script>
<script src="https://unpkg.com/@saccadejs/plugin-preview"></script>
<script src="https://unpkg.com/@saccadejs/plugin-calibrate"></script>
<script>
  const jsPsych = initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] });

  jsPsych.run([
    { type: jsPsychSaccadePreview },
    { type: jsPsychSaccadeCalibrate }, // the default 13-point grid
  ]);
</script>
```

## Parameters

| Parameter                     | Type                | Default         | Description                                                                                                                                                                    |
| ----------------------------- | ------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `calibration_points`          | array of `[x, y]`   | _13-point grid_ | Targets as percentages of the viewport width and height. The default is the grid the model was trained with: a 3×3 grid at 5/50/95 % plus four interior points at 27.5/72.5 %. |
| `calibration_mode`            | `"view"`\|`"click"` | `"view"`        | `"view"` shows each point for a fixed time; `"click"` leaves it up until the participant clicks it, then captures.                                                             |
| `repetitions_per_point`       | integer             | `1`             | How many times to repeat the whole sequence.                                                                                                                                   |
| `randomize_calibration_order` | boolean             | `false`         | Shuffle the order of the targets on each repetition.                                                                                                                           |
| `time_to_saccade`             | integer             | `1000`          | Settle time in ms before anything is recorded. The ring shrinks over this interval.                                                                                            |
| `time_per_point`              | integer             | `500`           | Capture time in ms at each point, once the participant has settled. The ring is green for this interval.                                                                       |
| `point_size`                  | integer             | `20`            | Diameter of the dot in pixels. The ring is four times this.                                                                                                                    |
| `lambda`                      | float               | `null`          | Ridge penalty. `null` lets the core choose with `lambdaFor(nPoints)`: 3 for nine points or fewer, otherwise 1.                                                                 |
| `clear_previous`              | boolean             | `true`          | Discard calibration points collected earlier in the experiment before starting. Set `false` to add points to an existing calibration.                                          |

## Data generated

| Name                    | Type    | Description                                                                                                                                                                                                                      |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calibration_points_px` | array   | The targets that were shown, in presentation order, as `[x, y]` pairs in viewport **pixels**. With `repetitions_per_point > 1` each target appears once per repetition. (The `calibration_points` _parameter_ stays in percent.) |
| `n_points`              | integer | The number of distinct targets used.                                                                                                                                                                                             |
| `repetitions_per_point` | integer | How many times the sequence was repeated.                                                                                                                                                                                        |
| `lambda`                | float   | The ridge penalty the fit actually used, whether from the parameter or from `lambdaFor(n_points)`. `null` if the fit failed (no usable points).                                                                                  |
| `rt`                    | integer | Time from the start of the trial until calibration finished.                                                                                                                                                                     |

## Notes

- **More points is better, up to a point.** The 13-point default is what the model was trained
  with. The core also provides a 20-point grid; you can pass any list you like.
- **Recalibrate after a break.** The calibration is tied to the participant's head position; if
  they move, run this plugin again (with `clear_previous: true`).
- Follow calibration with [`saccade-validate`](../plugin-saccadejs-validate) to find out how
  accurate the fit actually is before spending the participant's time on the experiment.

## License

MIT
