import type SaccadeExtension from "@saccadejs/extension";
import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";
import { runLoopback } from "saccadejs";
import type { LoopbackResult } from "saccadejs";

import { version } from "../package.json";

const STYLE_ID = "saccade-time-sync-style";

const CSS = `
#saccade-time-sync-intro {
  max-width: 680px;
  margin: 0 auto;
  padding: 24px 16px;
  text-align: left;
}
#saccade-time-sync-intro .saccade-time-sync-actions {
  text-align: center;
  margin-top: 24px;
}
#saccade-time-sync-progress {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 2147483001;
  width: 240px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #808080;
  color: #000;
  font: 12px/1.4 system-ui, sans-serif;
  text-align: center;
}
#saccade-time-sync-progress .saccade-bar {
  margin-top: 6px;
  height: 6px;
  border-radius: 3px;
  background: #595959;
  overflow: hidden;
}
#saccade-time-sync-progress .saccade-bar > div {
  height: 100%;
  width: 0%;
  background: #d9d9d9;
}
`;

const CONTRAST_LEVELS: Record<string, [string, string]> = {
  full: ["#000", "#fff"],
  reduced: ["#333", "#ccc"],
};

const info = <const>{
  name: "saccade-time-sync",
  version: version,
  parameters: {
    /** How long the measurement runs, in ms. Longer runs give more edges and a tighter estimate;
     * 15 s produces roughly 20 edges. */
    duration: {
      type: ParameterType.INT,
      default: 15000,
    },
    /** Minimum gap between brightness changes, in ms. */
    gap_min: {
      type: ParameterType.INT,
      default: 500,
    },
    /** Maximum gap between brightness changes, in ms. */
    gap_max: {
      type: ParameterType.INT,
      default: 1000,
    },
    /** `"full"` switches between black and white, which gives the strongest signal.
     * `"reduced"` uses dark grey and light grey, which is gentler on the participant at the cost
     * of a noisier estimate. */
    contrast: {
      type: ParameterType.SELECT,
      options: ["full", "reduced"],
      default: "full",
    },
    /** Instructions shown before the measurement starts. */
    instructions: {
      type: ParameterType.HTML_STRING,
      default: `
        <p>Before we start, we need to measure a small technical delay in your setup.</p>
        <p>Your screen takes a few milliseconds to actually show what the page draws, and your
        webcam takes a few more to timestamp what it sees. We need the total so that the
        eye-tracking data can be lined up with what was on the screen at the time.</p>
        <p>To measure it, the whole screen will change between two brightness levels at random
        moments, roughly once a second, for about 15 seconds, while the webcam watches your face.
        <strong>This is not a flashing or flickering display</strong> — there is at most one change
        per second, well below the level associated with photosensitive reactions.</p>
        <p>Please sit still and keep looking at the screen until it is finished.</p>`,
    },
    /** Text of the button that starts the measurement. */
    button_text: {
      type: ParameterType.STRING,
      default: "Start",
    },
    /** If true, an `UNRELIABLE` result is measured once more before the trial continues. The trial
     * always continues; the `verdict` field records what happened. */
    require_ok: {
      type: ParameterType.BOOL,
      default: false,
    },
    /** Whether to apply the measured lag to the extension, so that every later trial's
     * `saccade_data` timestamps have it subtracted. */
    apply_offset: {
      type: ParameterType.BOOL,
      default: true,
    },
  },
  data: {
    /** The measured display + camera lag, in ms: how much earlier than a frame's `captureTime`
     * the light it recorded actually left the screen. This is the constant to subtract from a gaze
     * timestamp to put it on the same clock as stimulus onsets. */
    lag_ms: {
      type: ParameterType.FLOAT,
    },
    /** Width, in ms, of the plateau of lag values that are consistent with every observed edge.
     * This is the uncertainty of `lag_ms`; one camera frame (about 33 ms) or less is expected. */
    plateau_width_ms: {
      type: ParameterType.FLOAT,
    },
    /** Peak of the edge-difference statistic, between 0 and 1. Values below 0.5 mean the camera
     * never really saw the screen change and the estimate should not be trusted. */
    peak_d: {
      type: ParameterType.FLOAT,
    },
    /** The lag estimated separately from the first and second half of the run, as `[first,
     * second]`. Two numbers that disagree mean the lag drifted during the run. */
    halves_ms: {
      type: ParameterType.FLOAT,
      array: true,
    },
    /** Mean interval between camera frames, in ms (33.3 for a 30 fps camera). */
    camera_period_ms: {
      type: ParameterType.FLOAT,
    },
    /** Standard deviation of the interval between camera frames, in ms. */
    camera_jitter_ms: {
      type: ParameterType.FLOAT,
    },
    /** Number of camera frames the browser reported dropping during the run. */
    dropped_frames: {
      type: ParameterType.INT,
    },
    /** Mean interval between animation frames during the run, in ms (16.7 on a 60 Hz display). */
    raf_period_ms: {
      type: ParameterType.FLOAT,
    },
    /** Which clock the camera timestamps came from: `"captureTime"` (best), `"receiveTime"`, or
     * `"callback"` (worst — the browser gave no capture timestamp at all). */
    clock_source: {
      type: ParameterType.STRING,
    },
    /** `"OK"`, `"INCONCLUSIVE"` or `"UNRELIABLE"`. `OK` means the estimate is well constrained;
     * `INCONCLUSIVE` means the signal was too weak or too few edges were seen; `UNRELIABLE` means
     * the run produced an estimate that contradicts itself and should not be used. */
    verdict: {
      type: ParameterType.STRING,
    },
    /** A short explanation of a non-`OK` verdict, or `null`. */
    reason: {
      type: ParameterType.STRING,
    },
    /** Whether the measured lag was applied to the extension (`apply_offset`). */
    applied: {
      type: ParameterType.BOOL,
    },
    /** Time in milliseconds from the start of the trial until the measurement finished. */
    rt: {
      type: ParameterType.INT,
    },
  },
  // prettier-ignore
  citations: '__CITATIONS__',
};

type Info = typeof info;

/**
 * Measures the combined display + camera lag with the saccade.js screen→webcam loopback, and
 * applies it to the extension so that gaze timestamps line up with stimulus onsets.
 *
 * The screen changes between two brightness levels at random moments about once a second; the
 * webcam watches the light those changes throw on the participant's face. Cross-correlating the
 * two gives the total lag on the `performance.now()` timeline jsPsych uses for stimulus onsets.
 * There is no flicker: at most one change per second, a third of the WCAG 2.3.1 / Harding limit.
 *
 * The `saccade` extension must be registered in `initJsPsych`.
 *
 * @author Josh de Leeuw
 * @see {@link https://jspsych.github.io/saccadejs/ saccade.js documentation}
 */
class SaccadeTimeSyncPlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>) {
    const extension = this.jsPsych.extensions.saccade as unknown as SaccadeExtension;
    if (!extension) {
      throw new Error(
        "The saccade-time-sync plugin requires the saccade extension. Add it to initJsPsych: " +
          "initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] })",
      );
    }

    injectStyle();

    const start_time = performance.now();
    let trial_complete: (value?: unknown) => void;

    const end_trial = (result: LoopbackResult | null, applied: boolean) => {
      display_element.innerHTML = "";

      const trial_data = {
        lag_ms: result ? result.lagMs : null,
        plateau_width_ms: result ? result.plateauWidthMs : null,
        peak_d: result ? result.peakD : null,
        halves_ms: result ? [result.halves.first, result.halves.second] : null,
        camera_period_ms: result ? result.cameraPeriodMs : null,
        camera_jitter_ms: result ? result.cameraJitterMs : null,
        dropped_frames: result ? result.droppedFrames : null,
        raf_period_ms: result ? result.rafPeriodMs : null,
        clock_source: result ? result.clockSource : null,
        verdict: result ? result.verdict : null,
        reason: result ? result.reason : null,
        applied,
        rt: Math.round(performance.now() - start_time),
      };

      this.jsPsych.finishTrial(trial_data);
      trial_complete();
    };

    const measure = async (): Promise<LoopbackResult> => {
      extension.hideVideo();
      extension.hidePredictions();

      if (!extension.isInitialized()) await extension.start();
      const tracker = extension.getTracker();

      // The loopback needs the *whole screen* to light the participant's face, so it draws on its
      // own full-viewport overlay on document.body (the core's default). Hide the jsPsych display
      // underneath for the duration, and put the progress readout on top of the overlay.
      const previousVisibility = display_element.style.visibility;
      display_element.style.visibility = "hidden";

      const progress = document.createElement("div");
      progress.id = "saccade-time-sync-progress";
      progress.innerHTML = `
        <span id="saccade-time-sync-label">Measuring…</span>
        <div class="saccade-bar"><div id="saccade-time-sync-fill"></div></div>`;
      document.body.appendChild(progress);
      const fill = progress.querySelector("#saccade-time-sync-fill") as HTMLElement;

      const options = {
        durationMs: trial.duration,
        gapMinMs: trial.gap_min,
        gapMaxMs: trial.gap_max,
        levels: CONTRAST_LEVELS[trial.contrast] ?? CONTRAST_LEVELS.full,
        onProgress: (fraction: number) => {
          if (fill) fill.style.width = `${Math.round(fraction * 100)}%`;
        },
      };

      try {
        let result = await runLoopback(tracker, options);
        if (trial.require_ok && result.verdict === "UNRELIABLE") {
          if (fill) fill.style.width = "0%";
          const label = progress.querySelector("#saccade-time-sync-label");
          if (label) label.textContent = "Measuring again…";
          result = await runLoopback(tracker, options);
        }
        return result;
      } finally {
        progress.remove();
        display_element.style.visibility = previousVisibility;
      }
    };

    const startMeasurement = () => {
      measure().then(
        (result) => {
          extension.setLastLoopback(result);
          const applied = !!trial.apply_offset && Number.isFinite(result.lagMs);
          if (applied) extension.setTimingOffset(result.lagMs);
          end_trial(result, applied);
        },
        (error) => {
          console.error(error);
          end_trial(null, false);
        },
      );
    };

    display_element.innerHTML = `
      <div id="saccade-time-sync-intro">
        ${trial.instructions}
        <div class="saccade-time-sync-actions">
          <button id="saccade-time-sync-start" class="jspsych-btn">${trial.button_text}</button>
        </div>
      </div>`;

    display_element
      .querySelector("#saccade-time-sync-start")
      .addEventListener("click", startMeasurement);

    return new Promise((resolve) => {
      trial_complete = resolve;
    });
  }
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export default SaccadeTimeSyncPlugin;
