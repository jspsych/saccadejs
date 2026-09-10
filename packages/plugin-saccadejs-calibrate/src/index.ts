import type SaccadeExtension from "@saccadejs/extension";
import type { CalWeighting } from "@saccadejs/extension";
import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";

import { version } from "../package.json";
import { TargetUi } from "./target-ui";

/**
 * The default 13-point grid, as `[x%, y%]` pairs. Matches `defaultGrid13()` in the core package:
 * a 3×3 grid at 5/50/95 %, plus four interior points at 27.5/72.5 %.
 */
const DEFAULT_GRID_13: [number, number][] = [
  [5, 5],
  [50, 5],
  [95, 5],
  [5, 50],
  [50, 50],
  [95, 50],
  [5, 95],
  [50, 95],
  [95, 95],
  [27.5, 27.5],
  [72.5, 27.5],
  [27.5, 72.5],
  [72.5, 72.5],
];

const info = <const>{
  name: "saccade-calibrate",
  version: version,
  parameters: {
    /** Array of calibration targets as `[x, y]` pairs, given as a percentage of the viewport
     * width and height from the left and top edges. The default is the 13-point grid used to
     * train the model. */
    calibration_points: {
      type: ParameterType.INT,
      default: DEFAULT_GRID_13,
      array: true,
    },
    /** `"view"` shows each point for a fixed time and captures passively; `"click"` leaves each
     * point on screen until the participant clicks it, then captures. */
    calibration_mode: {
      type: ParameterType.SELECT,
      options: ["view", "click"],
      default: "view",
    },
    /** How many times to repeat the whole sequence of calibration points. */
    repetitions_per_point: {
      type: ParameterType.INT,
      default: 1,
    },
    /** Whether to shuffle the order of the calibration points on each repetition. */
    randomize_calibration_order: {
      type: ParameterType.BOOL,
      default: false,
    },
    /** Settle time, in ms: how long the participant gets to move their eyes to a new point
     * before anything is recorded. The ring shrinks onto the dot over this interval. */
    time_to_saccade: {
      type: ParameterType.INT,
      default: 1000,
    },
    /** Capture time, in ms: how long embeddings are collected at each point once the participant
     * has settled. The ring turns green while this is happening. */
    time_per_point: {
      type: ParameterType.INT,
      default: 500,
    },
    /** Diameter of the calibration dot, in pixels. The ring around it is four times this size. */
    point_size: {
      type: ParameterType.INT,
      default: 20,
    },
    /** Ridge penalty used to fit the calibration. `null` lets the core choose with
     * `lambdaFor(nPoints)` — 3 for nine points or fewer, otherwise 1. */
    lambda: {
      type: ParameterType.FLOAT,
      default: null,
    },
    /** Whether to discard any calibration points collected earlier in the experiment before
     * starting. Set to `false` to add points to an existing calibration. */
    clear_previous: {
      type: ParameterType.BOOL,
      default: true,
    },
  },
  data: {
    /** The calibration targets that were shown, in the order they appeared, as `[x, y]` pairs in
     * viewport **pixels**. With `repetitions_per_point > 1` each target appears once per
     * repetition. (The `calibration_points` *parameter* stays in percent.) */
    calibration_points_px: {
      type: ParameterType.INT,
      array: true,
    },
    /** The number of distinct calibration targets used. */
    n_points: {
      type: ParameterType.INT,
    },
    /** How many times the sequence of targets was repeated. */
    repetitions_per_point: {
      type: ParameterType.INT,
    },
    /** The ridge penalty the fit used, whether it came from the `lambda` parameter or from
     * `lambdaFor(n_points)`. `null` if the fit failed. */
    lambda: {
      type: ParameterType.FLOAT,
    },
    /** How the fit weighted its calibration rows: `"model"` (per-frame weights from the
     * model's own second output), `"head"` (a `calHead` supplied to the tracker), or
     * `"uniform"` (unweighted). `null` if the fit failed. Recorded because a weighted and an
     * unweighted fit are different analyses, and nothing else in the data distinguishes
     * them. */
    weighting: {
      type: ParameterType.STRING,
    },
    /** Time in milliseconds from the start of the trial until calibration finished. */
    rt: {
      type: ParameterType.INT,
    },
  },
  // prettier-ignore
  citations: '__CITATIONS__',
};

type Info = typeof info;

/**
 * Calibrates saccade.js: shows a sequence of targets, collects eye embeddings while the
 * participant looks at each one, and fits the ridge regression that maps embeddings to gaze.
 *
 * The `saccade` extension must be registered in `initJsPsych`, and the camera must already be
 * running (use the `saccade-preview` plugin first).
 *
 * @author Josh de Leeuw
 * @see {@link https://saccade.jspsych.org/reference/plugin-calibrate/ saccade.js: the saccade-calibrate plugin}
 */
class SaccadeCalibratePlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>) {
    const extension = this.jsPsych.extensions.saccade as unknown as SaccadeExtension;
    if (!extension) {
      throw new Error(
        "The saccade-calibrate plugin requires the saccade extension. Add it to initJsPsych: " +
          "initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] })",
      );
    }

    const start_time = performance.now();
    const ui = new TargetUi(display_element, trial.point_size);
    const shown_points: [number, number][] = [];

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => this.jsPsych.pluginAPI.setTimeout(resolve, ms));

    const waitForClick = () =>
      new Promise<void>((resolve) => {
        const handler = () => {
          ui.element.removeEventListener("click", handler);
          resolve();
        };
        ui.element.addEventListener("click", handler);
      });

    const end_trial = (
      fit: { lambda: number; nPoints: number; weighting: CalWeighting } | null,
    ) => {
      ui.destroy();
      extension.hidePredictions();
      display_element.innerHTML = "";

      const distinct = new Set(shown_points.map((p) => `${p[0]},${p[1]}`));

      this.jsPsych.finishTrial({
        calibration_points_px: shown_points,
        n_points: distinct.size,
        repetitions_per_point: trial.repetitions_per_point,
        lambda: fit ? fit.lambda : null,
        weighting: fit ? fit.weighting : null,
        rt: Math.round(performance.now() - start_time),
      });
    };

    const run = async () => {
      if (trial.clear_previous) extension.resetCalibration();
      extension.hidePredictions();
      extension.resume();

      const clickMode = trial.calibration_mode === "click";
      ui.setClickable(clickMode);

      for (let rep = 0; rep < trial.repetitions_per_point; rep++) {
        // `ParameterType.INT` + `array: true` types this as `number[]`; it is really `[x, y]` pairs.
        const declared = trial.calibration_points as unknown as [number, number][];
        const points = trial.randomize_calibration_order
          ? this.jsPsych.randomization.shuffle(declared)
          : declared;

        for (const pt of points) {
          const x = (pt[0] / 100) * viewportWidth();
          const y = (pt[1] / 100) * viewportHeight();
          shown_points.push([Math.round(x), Math.round(y)]);

          ui.moveTo(`${pt[0]}%`, `${pt[1]}%`);

          if (clickMode) {
            ui.setPhase("idle");
            await waitForClick();
          } else {
            ui.setPhase("settle", trial.time_to_saccade);
            await sleep(trial.time_to_saccade);
          }

          ui.setPhase("capture");
          await extension.calibratePoint(x, y, undefined, trial.time_per_point);
        }
      }

      ui.hide();
      return extension.fitCalibration(trial.lambda ?? undefined);
    };

    run().then(end_trial, (error) => {
      // Usually the core's stall guard ("no camera frames for 5000 ms"), which used to be an
      // indefinite wait on a target that never moved. Say what happened instead of freezing.
      console.error(error);
      ui.hide();
      ui.showFailure(
        `Calibration could not finish: ${String(error?.message ?? error)}. ` +
          "Check that nothing else is using your camera, then continue.",
      ).then(() => end_trial(null));
    });
  }
}

function viewportWidth(): number {
  return window.innerWidth || document.documentElement.clientWidth || 1;
}

function viewportHeight(): number {
  return window.innerHeight || document.documentElement.clientHeight || 1;
}

export default SaccadeCalibratePlugin;
