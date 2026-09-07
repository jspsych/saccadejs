import type SaccadeExtension from "@saccadejs/extension";
import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";

import { version } from "../package.json";
import { FrameSample, PerformanceStats, summarise } from "./stats";

/**
 * What this trial records, and what `inclusion_function` and `exclusion_message` are handed.
 * Exported so a TypeScript experiment can type its own callbacks against it.
 */
export interface SaccadePerformanceData extends PerformanceStats {
  /** The execution provider the model is running on: `"webgpu"` or `"wasm"`. */
  backend: string | null;
  /** Time in ms from the start of the trial until the measurement finished. */
  rt: number;
}

/** What the participant looks at while the measurement runs. */
const DEFAULT_STIMULUS = `
  <p>Checking how fast the eye tracker runs on this computer.</p>
  <p>Look at the dot and hold still for a few seconds.</p>
  <div style="width:20px; height:20px; margin:2rem auto; border-radius:50%;
    background:#f00;"></div>`;

const DEFAULT_EXCLUSION_MESSAGE = `
  <p>Unfortunately this computer cannot run the eye tracker fast enough for this study, so we
  cannot collect usable data from you.</p>
  <p>This is a limitation of the hardware and browser, not anything you did. Thank you for your
  time.</p>`;

const info = <const>{
  name: "saccade-performance",
  version: version,
  parameters: {
    /** What to show while the measurement runs. The default asks the participant to look at a
     * dot and hold still, which is what makes the measurement comparable between participants:
     * a face has to be in view for the frame to reach the model at all. */
    stimulus: {
      type: ParameterType.HTML_STRING,
      default: DEFAULT_STIMULUS,
    },
    /** How long, in ms, to measure for once the warm-up has passed. Longer is steadier; five
     * seconds is enough for the percentiles to mean something without making every participant
     * wait. */
    measurement_duration: {
      type: ParameterType.INT,
      default: 5000,
    },
    /** How long, in ms, to discard before measuring. The first frames after the tracker starts
     * or resumes pay for shader compilation, the first WebGPU submit and the camera's own
     * exposure ramp, and are not representative of the rate the experiment will actually run
     * at. */
    warmup_duration: {
      type: ParameterType.INT,
      default: 1000,
    },
    /** A function that receives the measured data and returns `true` if this machine is fast
     * enough for the study. The default includes everyone: the trial measures and records, and
     * you decide what to do with the numbers later.
     *
     * There is no default threshold because the rate a study needs is a property of the study —
     * a ten-second free-viewing preference measure is fine at a few frames per second, and
     * saccade latencies are not.
     *
     * A machine the trial could not measure at all arrives here with `fps_median: null`, and
     * `null >= 15` is `false`, so the obvious comparison excludes it without any extra work.
     * That is the right default: a participant whose frame rate is unknown is not one who
     * passed. */
    inclusion_function: {
      type: ParameterType.FUNCTION,
      default: (_data: SaccadePerformanceData) => true,
    },
    /** A function that receives the measured data and returns the HTML to show when
     * `inclusion_function` returns `false`. Return something different for different reasons —
     * a machine that fell back to `wasm` can be told so — and remember the participant may have
     * been recruited on a panel that expects a specific wording. */
    exclusion_message: {
      type: ParameterType.FUNCTION,
      default: (_data: SaccadePerformanceData) => DEFAULT_EXCLUSION_MESSAGE,
    },
  },
  data: {
    /** The median frame rate over the measurement window, in Hz. **The headline number**, and
     * the one `minimum_fps` is compared against. `null` if no two consecutive frames with a
     * face in them were seen. */
    fps_median: {
      type: ParameterType.FLOAT,
    },
    /** Frames per second averaged over the whole window. */
    fps_mean: {
      type: ParameterType.FLOAT,
    },
    /** The rate at the slow end: the 10th percentile of frame rate, i.e. the 90th percentile of
     * the interval between frames. A machine that stalls periodically has a healthy
     * `fps_median` and a poor `fps_p10`. */
    fps_p10: {
      type: ParameterType.FLOAT,
    },
    /** Frames with a face in them during the measurement window — the frames the statistics
     * are computed from. */
    frames: {
      type: ParameterType.INT,
    },
    /** Frames in the window with no face in them. These never reach the model, so they are
     * excluded from the rates; a large number here means the participant was out of frame and
     * the measurement covers less time than it looks. */
    frames_without_face: {
      type: ParameterType.INT,
    },
    /** Camera frames that were presented but never processed during the window, as reported by
     * `requestVideoFrameCallback`. This is how far behind the camera the tracker fell. */
    dropped: {
      type: ParameterType.INT,
    },
    /** Median time in ms spent in the model for one frame. Together with `fps_median` this
     * separates a slow model from a slow camera: a low frame rate with a small
     * `embed_ms_median` is a camera that is not delivering frames any faster. */
    embed_ms_median: {
      type: ParameterType.FLOAT,
    },
    /** The execution provider the model is running on: `"webgpu"` or `"wasm"`. */
    backend: {
      type: ParameterType.STRING,
    },
    /** Time in ms from the start of the trial until the measurement finished. */
    rt: {
      type: ParameterType.INT,
    },
  },
  // prettier-ignore
  citations: '__CITATIONS__',
};

type Info = typeof info;

/**
 * Measures how fast saccade.js actually runs on this participant's machine, and optionally uses
 * that to exclude machines too slow for the study.
 *
 * The exclusion machinery is
 * {@link https://www.jspsych.org/latest/plugins/browser-check/ `browser-check`}'s, deliberately:
 * an `inclusion_function` over the measured data, an `exclusion_message` built from the same
 * data, and an experiment that ends there when the two disagree. A study that already gates on
 * browser and screen size gains one more gate written the same way.
 *
 * Put it after `saccade-preview` (the camera and the model have to be running) and before
 * `saccade-calibrate`, so that a participant who is going to be excluded is not first made to
 * sit through a calibration.
 *
 * The `saccade` extension must be registered in `initJsPsych`.
 *
 * @author Josh de Leeuw
 * @see {@link https://saccade.jspsych.org/reference/plugin-performance/ saccade.js: the saccade-performance plugin}
 */
class SaccadePerformancePlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>, on_load: () => void) {
    const extension = this.jsPsych.extensions.saccade as unknown as SaccadeExtension;
    if (!extension) {
      throw new Error(
        "The saccade-performance plugin requires the saccade extension. Add it to initJsPsych: " +
          "initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] })",
      );
    }

    const start_time = performance.now();
    const samples: FrameSample[] = [];
    let unsubscribe: (() => void) | null = null;
    // Frames arriving before this goes true are the warm-up, and are thrown away.
    let measuring = false;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => this.jsPsych.pluginAPI.setTimeout(resolve, ms));

    const end_trial = (error: string | null) => {
      unsubscribe?.();
      unsubscribe = null;

      const trial_data: SaccadePerformanceData = {
        ...summarise(samples),
        backend: extension.getBackend(),
        rt: Math.round(performance.now() - start_time),
      };

      display_element.innerHTML = "";

      if (error) console.error(error);

      if (!trial.inclusion_function(trial_data)) {
        // Same shape as `browser-check`: a failed inclusion ends the experiment, and
        // `abortExperiment` finishes this trial with the data itself, so the measurement is
        // still in the data of a participant who was turned away.
        this.jsPsych.abortExperiment(trial.exclusion_message(trial_data), trial_data);
        return;
      }
      this.jsPsych.finishTrial(trial_data);
    };

    const measure = async () => {
      display_element.innerHTML = trial.stimulus;
      on_load();

      // Nothing should be drawn over the stimulus, and the tracker has to be running: the
      // preview trial pauses it on the way out.
      extension.hidePredictions();
      extension.resume();

      unsubscribe = extension.getTracker().onFrame((frame) => {
        if (!measuring) return;
        samples.push({
          t: frame.time.capture,
          faceFound: frame.faceFound,
          embedMs: frame.timings.embed,
          dropped: frame.time.dropped ?? 0,
        });
      });

      await sleep(trial.warmup_duration);
      measuring = true;
      await sleep(trial.measurement_duration);
    };

    const begin = extension.isInitialized() ? Promise.resolve() : extension.start();

    begin.then(measure).then(
      () => end_trial(null),
      // Whatever went wrong — the camera was never granted, the model would not load — the
      // trial still ends, with null statistics and `passed: false` where a threshold was set.
      // Freezing here would strand the participant on a screen with no way forward.
      (err: unknown) => end_trial(String((err as Error)?.message ?? err)),
    );
  }
}

export default SaccadePerformancePlugin;
