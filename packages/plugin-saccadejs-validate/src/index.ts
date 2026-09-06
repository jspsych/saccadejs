import type SaccadeExtension from "@saccadejs/extension";
import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";

import { version } from "../package.json";
import { TargetUi } from "./target-ui";

/**
 * The default 9-point validation grid, as `[x%, y%]` pairs. Matches `validationGrid9()` in the
 * core package: a 3×3 grid at 15/50/85 %, pulled in from the calibration grid's extremes so that
 * validation does not simply re-test the calibration targets.
 */
const DEFAULT_GRID_9: [number, number][] = [
  [15, 15],
  [50, 15],
  [85, 15],
  [15, 50],
  [50, 50],
  [85, 50],
  [15, 85],
  [50, 85],
  [85, 85],
];

interface GazeRow {
  x: number;
  y: number;
  dx: number;
  dy: number;
  t: number;
}

const info = <const>{
  name: "saccade-validate",
  version: version,
  parameters: {
    /** Array of validation targets as `[x, y]` pairs. Interpreted according to
     * `validation_point_coordinates`. */
    validation_points: {
      type: ParameterType.INT,
      default: DEFAULT_GRID_9,
      array: true,
    },
    /** Whether `validation_points` are percentages of the viewport width and height
     * (`"percent"`) or pixel offsets from the center of the viewport
     * (`"center-offset-pixels"`). */
    validation_point_coordinates: {
      type: ParameterType.SELECT,
      options: ["percent", "center-offset-pixels"],
      default: "percent",
    },
    /** Radius, in pixels, of the region of interest around each validation point. Samples inside
     * it count towards `percent_in_roi`. */
    roi_radius: {
      type: ParameterType.INT,
      default: 200,
    },
    /** Whether to shuffle the order of the validation points. */
    randomize_validation_order: {
      type: ParameterType.BOOL,
      default: false,
    },
    /** Settle time, in ms, before gaze is recorded at each point. The ring shrinks onto the dot
     * over this interval. */
    time_to_saccade: {
      type: ParameterType.INT,
      default: 1000,
    },
    /** How long, in ms, to record gaze at each point once the participant has settled. */
    validation_duration: {
      type: ParameterType.INT,
      default: 2000,
    },
    /** Diameter of the validation dot, in pixels. */
    point_size: {
      type: ParameterType.INT,
      default: 20,
    },
    /** If true, a summary of the validation data is shown on screen when validation finishes, and
     * the participant clicks to continue. Useful while piloting, not in a real experiment. */
    show_validation_data: {
      type: ParameterType.BOOL,
      default: false,
    },
  },
  data: {
    /** Raw gaze data, with one nested array per validation point (in the order the points were
     * shown). Each entry is `{x, y, dx, dy, t}`: the absolute gaze position in viewport pixels,
     * its offset from the target in pixels, and the time in ms since the start of the trial. */
    raw_gaze: {
      type: ParameterType.COMPLEX,
      array: true,
      nested: {
        x: { type: ParameterType.INT },
        y: { type: ParameterType.INT },
        dx: { type: ParameterType.INT },
        dy: { type: ParameterType.INT },
        t: { type: ParameterType.INT },
      },
    },
    /** For each validation point, the percentage of samples that fell within `roi_radius` of it. */
    percent_in_roi: {
      type: ParameterType.FLOAT,
      array: true,
    },
    /** For each validation point, the average `x` and `y` offset of gaze from the target, plus the
     * median distance `r` of the individual samples from that average offset (i.e. precision). */
    average_offset: {
      type: ParameterType.COMPLEX,
      array: true,
      nested: {
        x: { type: ParameterType.FLOAT },
        y: { type: ParameterType.FLOAT },
        r: { type: ParameterType.FLOAT },
      },
    },
    /** The average number of gaze samples per second, averaged over validation points. */
    samples_per_sec: {
      type: ParameterType.FLOAT,
    },
    /** The list of validation points, in the order they were shown. */
    validation_points: {
      type: ParameterType.INT,
      array: true,
    },
    /** The median, across validation points, of the distance in pixels between the target and the
     * average gaze position for that target. The headline accuracy number. */
    median_error_px: {
      type: ParameterType.FLOAT,
    },
    /** The same error expressed in viewport units (the error in x divided by the viewport width,
     * in y by the height), which is comparable across screen sizes and is the unit the model was
     * evaluated in. */
    median_error_viewport: {
      type: ParameterType.FLOAT,
    },
    /** Time in milliseconds from the start of the trial until validation finished. */
    rt: {
      type: ParameterType.INT,
    },
  },
  // prettier-ignore
  citations: '__CITATIONS__',
};

type Info = typeof info;

/**
 * Measures the accuracy and precision of the current saccade.js calibration by showing a grid of
 * targets and comparing the gaze predictions with where the participant was asked to look.
 *
 * The `saccade` extension must be registered in `initJsPsych`, and the tracker must be calibrated
 * (use the `saccade-calibrate` plugin first).
 *
 * @author Josh de Leeuw
 * @see {@link https://jspsych.github.io/saccadejs/ saccade.js documentation}
 */
class SaccadeValidatePlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>) {
    const extension = this.jsPsych.extensions.saccade as unknown as SaccadeExtension;
    if (!extension) {
      throw new Error(
        "The saccade-validate plugin requires the saccade extension. Add it to initJsPsych: " +
          "initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] })",
      );
    }

    const start_time = performance.now();
    const ui = new TargetUi(display_element, trial.point_size);
    const raw_gaze: GazeRow[][] = [];

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => this.jsPsych.pluginAPI.setTimeout(resolve, ms));

    // Pixel position of a validation point, in both coordinate modes.
    const toPixels = (pt: [number, number]): { x: number; y: number } =>
      trial.validation_point_coordinates === "percent"
        ? { x: (pt[0] / 100) * viewportWidth(), y: (pt[1] / 100) * viewportHeight() }
        : { x: viewportWidth() / 2 + pt[0], y: viewportHeight() / 2 + pt[1] };

    // CSS position of a validation point, in both coordinate modes.
    const toCss = (pt: [number, number]): { left: string; top: string } =>
      trial.validation_point_coordinates === "percent"
        ? { left: `${pt[0]}%`, top: `${pt[1]}%` }
        : { left: `calc(50% + ${pt[0]}px)`, top: `calc(50% + ${pt[1]}px)` };

    const end_trial = (val_points: [number, number][]) => {
      const percent_in_roi = raw_gaze.map((rows) => percentInRoi(rows, trial.roi_radius));
      const average_offset = raw_gaze.map((rows) => gazeCentroid(rows));

      // Points where no gaze sample was recorded have no offset and cannot contribute an error.
      const measured = average_offset.filter((o) => o.x !== null && o.y !== null);
      const errorsPx = measured.map((o) => Math.sqrt(o.x * o.x + o.y * o.y));
      const errorsViewport = measured.map((o) =>
        Math.sqrt(Math.pow(o.x / viewportWidth(), 2) + Math.pow(o.y / viewportHeight(), 2)),
      );

      ui.destroy();
      display_element.innerHTML = "";

      this.jsPsych.finishTrial({
        raw_gaze,
        percent_in_roi,
        average_offset,
        samples_per_sec: sampleRate(raw_gaze),
        validation_points: val_points,
        median_error_px: median(errorsPx.filter((v) => Number.isFinite(v))),
        median_error_viewport: median(errorsViewport.filter((v) => Number.isFinite(v))),
        rt: Math.round(performance.now() - start_time),
      });
    };

    const showResults = (val_points: [number, number][]) =>
      new Promise<void>((resolve) => {
        let html = "";
        for (let i = 0; i < val_points.length; i++) {
          const { x, y } = toPixels(val_points[i]);
          html += `<div style="position:absolute; left:${x - trial.roi_radius}px; top:${
            y - trial.roi_radius
          }px; width:${trial.roi_radius * 2}px; height:${
            trial.roi_radius * 2
          }px; border:2px dotted #666; border-radius:50%;"></div>`;
          for (const row of raw_gaze[i] ?? []) {
            const inside = Math.sqrt(row.dx * row.dx + row.dy * row.dy) <= trial.roi_radius;
            html += `<div style="position:absolute; left:${row.x - 2}px; top:${
              row.y - 2
            }px; width:5px; height:5px; border-radius:50%; opacity:0.8; background:${
              inside ? "#4ade80" : "#f87171"
            };"></div>`;
          }
          html += `<div style="position:absolute; left:${x - trial.point_size / 2}px; top:${
            y - trial.point_size / 2
          }px; width:${trial.point_size}px; height:${
            trial.point_size
          }px; border-radius:50%; background:#fff;"></div>`;
        }
        html += `<button id="saccade-validate-continue" class="jspsych-btn"
          style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);">Continue</button>`;
        ui.overlay.innerHTML = html;
        ui.overlay
          .querySelector("#saccade-validate-continue")
          .addEventListener("click", () => resolve());
      });

    const run = async (): Promise<[number, number][]> => {
      extension.hidePredictions();
      extension.resume();

      // `ParameterType.INT` + `array: true` types this as `number[]`; it is really `[x, y]` pairs.
      const declared = trial.validation_points as unknown as [number, number][];
      const val_points = trial.randomize_validation_order
        ? this.jsPsych.randomization.shuffle(declared)
        : declared;

      for (const pt of val_points) {
        const { x, y } = toPixels(pt);
        const css = toCss(pt);
        ui.moveTo(css.left, css.top);
        ui.setPhase("settle", trial.time_to_saccade);
        await sleep(trial.time_to_saccade);

        const rows: GazeRow[] = [];
        const unsubscribe = extension.onGazeUpdate((prediction) => {
          rows.push({
            x: prediction.x,
            y: prediction.y,
            dx: prediction.x - x,
            dy: prediction.y - y,
            t: Math.round(prediction.t - start_time),
          });
        });

        ui.setPhase("capture");
        await sleep(trial.validation_duration);
        unsubscribe();
        raw_gaze.push(rows);
      }

      ui.hide();
      if (trial.show_validation_data) await showResults(val_points);
      return val_points;
    };

    run().then(end_trial, (error) => {
      console.error(error);
      end_trial([]);
    });
  }
}

function viewportWidth(): number {
  return window.innerWidth || document.documentElement.clientWidth || 1;
}

function viewportHeight(): number {
  return window.innerHeight || document.documentElement.clientHeight || 1;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentInRoi(rows: GazeRow[], radius: number): number {
  if (rows.length === 0) return 0;
  const inside = rows.filter((r) => Math.sqrt(r.dx * r.dx + r.dy * r.dy) <= radius).length;
  return (inside / rows.length) * 100;
}

function gazeCentroid(rows: GazeRow[]): { x: number; y: number; r: number } {
  if (rows.length === 0) return { x: null, y: null, r: null };
  const mx = rows.reduce((a, r) => a + r.dx, 0) / rows.length;
  const my = rows.reduce((a, r) => a + r.dy, 0) / rows.length;
  const r = median(rows.map((p) => Math.sqrt(Math.pow(p.dx - mx, 2) + Math.pow(p.dy - my, 2))));
  return { x: mx, y: my, r };
}

function sampleRate(gazeData: GazeRow[][]): number | null {
  const meanDiffs: number[] = [];
  for (const rows of gazeData) {
    if (rows.length < 2) continue;
    const diffs: number[] = [];
    for (let j = 1; j < rows.length; j++) diffs.push(rows[j].t - rows[j - 1].t);
    meanDiffs.push(diffs.reduce((a, b) => a + b, 0) / diffs.length);
  }
  if (meanDiffs.length === 0) return null;
  const mean = meanDiffs.reduce((a, b) => a + b, 0) / meanDiffs.length;
  return mean > 0 ? 1000 / mean : null;
}

export default SaccadeValidatePlugin;
