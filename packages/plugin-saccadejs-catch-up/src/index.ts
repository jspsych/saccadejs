import type SaccadeExtension from "@saccadejs/extension";
import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";

import { version } from "../package.json";

const DEFAULT_MESSAGE = `
  <p>Finishing up. Please keep this window open.</p>`;

const info = <const>{
  name: "saccade-catch-up",
  version: version,
  parameters: {
    /** What to show while the background workers finish. A progress bar and an estimate of the
     * time left are shown under it when `show_progress` is true. */
    message: {
      type: ParameterType.HTML_STRING,
      default: DEFAULT_MESSAGE,
    },
    /** The longest the participant may be kept waiting, in ms. `null` waits until every frame
     * is embedded, however long that takes. When it runs out, the frames still queued are given
     * up on: see `save_unprocessed_crops`. */
    max_wait: {
      type: ParameterType.INT,
      default: null,
    },
    /** Frames given up on at `max_wait` are discarded unless this is true. Then their eye crops
     * are written into their trials' `saccade_deferred.crops`, so they can be embedded offline
     * and nothing is lost. A 144 x 36 strip across both eyes is a recognisable picture of a
     * person: check what your consent form and data sharing plan allow before turning this
     * on, and delete the crops once they are processed. */
    save_unprocessed_crops: {
      type: ParameterType.BOOL,
      default: false,
    },
    /** Stop the frame loop while waiting, which gives its CPU time to the workers. It is
     * started again afterwards if it was running before. Gaze is not recorded during this
     * trial either way. */
    pause_tracking: {
      type: ParameterType.BOOL,
      default: true,
    },
    /** Show a progress bar and an estimate of the time left under `message`. */
    show_progress: {
      type: ParameterType.BOOL,
      default: true,
    },
  },
  data: {
    /** `"live"` or `"deferred"`. In live mode there is never anything to wait for, and the
     * trial ends as soon as it starts. */
    mode: {
      type: ParameterType.STRING,
    },
    /** Frames that were still waiting for, or being embedded by, a worker when the trial
     * started. */
    frames_waiting: {
      type: ParameterType.INT,
    },
    /** Frames that will never be embedded in the browser: given up on at `max_wait`, or lost
     * earlier from a full queue. Their trials count them in `saccade_deferred.lost`. */
    frames_lost: {
      type: ParameterType.INT,
    },
    /** Whether `max_wait` ran out before the workers finished. */
    timed_out: {
      type: ParameterType.BOOL,
    },
    /** Lost frames whose eye crops were saved for offline processing. */
    crops_saved: {
      type: ParameterType.INT,
    },
    /** How long the participant waited, in ms. */
    wait_ms: {
      type: ParameterType.INT,
    },
  },
  // prettier-ignore
  citations: '__CITATIONS__',
};

type Info = typeof info;

/**
 * Waits for saccade.js's deferred mode to catch up: the background workers finish embedding the
 * frames that recording trials queued, and every trial's `saccade_data` is filled in.
 *
 * Run it before the data is saved, and wherever else a pause would let the workers catch up,
 * such as a break between blocks. In live mode it ends immediately, so an experiment can
 * include it unconditionally.
 *
 * The `saccade` extension must be registered in `initJsPsych`.
 *
 * @author Josh de Leeuw
 * @see {@link https://saccade.jspsych.org/reference/plugin-catch-up/ saccade.js: the saccade-catch-up plugin}
 */
class SaccadeCatchUpPlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>, on_load: () => void) {
    const extension = this.jsPsych.extensions.saccade as unknown as SaccadeExtension;
    if (!extension) {
      throw new Error(
        "The saccade-catch-up plugin requires the saccade extension. Add it to initJsPsych: " +
          "initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] })",
      );
    }

    const tracker = extension.isInitialized() ? extension.getTracker() : null;
    const wasRunning = tracker?.running ?? false;
    const deferred = extension.getMode() === "deferred";

    if (deferred) {
      display_element.innerHTML = `
        <div id="saccade-catch-up">
          ${trial.message}
          ${
            trial.show_progress
              ? `<div style="width:min(320px, 80vw); height:8px; margin:1rem auto 0.5rem;
                  background:#ddd; border-radius:4px; overflow:hidden;">
                  <div id="saccade-catch-up-bar" style="width:0%; height:100%;
                    background:#4a7; transition:width 0.2s;"></div>
                </div>
                <p id="saccade-catch-up-status" style="margin:0;"></p>`
              : ""
          }
        </div>`;
      if (trial.pause_tracking && wasRunning) extension.pause();
    }
    on_load();

    const bar = display_element.querySelector<HTMLElement>("#saccade-catch-up-bar");
    const status = display_element.querySelector<HTMLElement>("#saccade-catch-up-status");
    const render = (pending: number, total: number) => {
      if (!bar || !status) return;
      const fraction = total > 0 ? 1 - pending / total : 1;
      bar.style.width = `${Math.round(100 * Math.max(0, Math.min(1, fraction)))}%`;
      const perSecond = tracker?.deferred?.throughput ?? null;
      status.textContent =
        pending > 0 && perSecond
          ? `About ${formatDuration(pending / perSecond)} left`
          : pending > 0
            ? "Working…"
            : "Done";
    };

    extension
      .catchUp({
        max_wait_ms: trial.max_wait,
        save_unprocessed_crops: trial.save_unprocessed_crops,
        onProgress: render,
      })
      .then((result) => {
        if (deferred && trial.pause_tracking && wasRunning) extension.resume();
        display_element.innerHTML = "";
        this.jsPsych.finishTrial({ ...result });
      });
  }
}

/** A duration for a participant: "1 minute", "40 seconds". */
function formatDuration(seconds: number): string {
  if (seconds >= 90) return `${Math.round(seconds / 60)} minutes`;
  if (seconds >= 55) return "1 minute";
  const s = Math.max(5, Math.ceil(seconds / 5) * 5);
  return `${s} seconds`;
}

export default SaccadeCatchUpPlugin;
