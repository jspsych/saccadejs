import { JsPsych, JsPsychExtension, JsPsychExtensionInfo, ParameterType } from "jspsych";
import { SaccadeTracker } from "@saccadejs/core";
import type { CalPoint, FrameTime, LoopbackResult, SaccadeAssets, TrackerFrame } from "@saccadejs/core";

import { version } from "../package.json";

/** One gaze sample, in **pixels** relative to the viewport, with a trial-relative timestamp. */
export interface SaccadeGazeSample {
  x: number;
  y: number;
  t: number;
}

/** The bounding rectangle of a target element, in viewport pixels. */
export interface SaccadeTargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** What is known about the timing of the samples in `saccade_data`. */
export interface SaccadeTimingInfo {
  offset_ms: number | null;
  corrected: boolean;
  clock: FrameTime["source"] | null;
  dropped_frames: number;
  fps: number | null;
  tta: number;
}

export interface InitializeParameters {
  /**
   * Whether to round the predicted x, y coordinates to the nearest integer pixel. Recommended,
   * because it saves a lot of space in the data and the predictions are nowhere near precise to
   * the level of a partial pixel.
   * @default true
   */
  round_predictions?: boolean;
  /**
   * Whether to initialize the tracker (camera permission prompt + model download) as soon as the
   * extension loads. Leave this `false` if you use the `saccade-preview` plugin, which does the
   * initialization at a controlled point in the timeline.
   * @default false
   */
  auto_initialize?: boolean;
  /**
   * Size of the test-time-augmentation ring buffer: the number of consecutive frames whose
   * embeddings are averaged before the gaze prediction is made. Larger values are smoother but
   * add group delay.
   * @default 5
   */
  tta?: number;
  /**
   * URLs for the model and wasm assets (`SaccadeAssets`). Set these to self-host instead of
   * loading from the CDN.
   * @default {}
   */
  assets?: SaccadeAssets;
  /**
   * A pre-built `SaccadeTracker` to use instead of letting the extension construct one. Useful
   * when the same tracker is shared with non-jsPsych code on the page.
   */
  tracker?: SaccadeTracker;
}

interface OnStartParameters {
  targets: Array<string>;
}

const STYLE_ID = "saccade-extension-style";
const VIDEO_CONTAINER_ID = "saccade-video-container";
const GAZE_DOT_ID = "saccade-gaze-dot";

const CSS = `
#${VIDEO_CONTAINER_ID} {
  position: fixed;
  bottom: 10px;
  left: 10px;
  z-index: 2147483646;
  line-height: 0;
  border-radius: 6px;
  overflow: hidden;
  background: #000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}
#${VIDEO_CONTAINER_ID} video {
  display: block;
  width: 100%;
  height: auto;
  transform: scaleX(-1);
}
#${GAZE_DOT_ID} {
  position: fixed;
  left: 0;
  top: 0;
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
  border-radius: 50%;
  background: rgba(255, 0, 0, 0.7);
  pointer-events: none;
  z-index: 2147483647;
  display: none;
}
#${GAZE_DOT_ID}.saccade-visible {
  display: block;
}
`;

/**
 * The saccade.js jsPsych extension. Mirrors `@jspsych/extension-webgazer`: add it to
 * `initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] })`, then opt individual trials
 * in with `extensions: [{ type: jsPsychExtensionSaccade, params: { targets: [...] } }]`.
 *
 * @see {@link https://jspsych.github.io/saccadejs/ saccade.js documentation}
 */
class SaccadeExtension implements JsPsychExtension {
  static info: JsPsychExtensionInfo = {
    name: "saccade",
    version: version,
    data: {
      /**
       * An array of gaze samples recorded during the trial, one per camera frame in which a face
       * was found and a calibrated gaze prediction was available. Each object has `x` and `y`
       * (the gaze location in pixels relative to the top-left of the viewport) and `t`
       * (`time.meanCapture ?? time.capture`, the instant the smoothed prediction actually refers
       * to, in milliseconds since the start of the trial, minus the timing offset when one has
       * been measured — see `saccade_timing`).
       */
      saccade_data: {
        type: ParameterType.COMPLEX,
        array: true,
        nested: {
          x: { type: ParameterType.INT },
          y: { type: ParameterType.INT },
          t: { type: ParameterType.INT },
        },
      },
      /**
       * An object containing the pixel coordinates of the elements named by the `targets`
       * parameter. Each key is the CSS selector used to find the element; the value has `x` and
       * `y` (top-left corner), `width` and `height`, plus the `top`, `bottom`, `left` and `right`
       * of the element's
       * [bounding rectangle](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect).
       */
      saccade_targets: {
        type: ParameterType.COMPLEX,
        nested: {
          x: { type: ParameterType.INT },
          y: { type: ParameterType.INT },
          width: { type: ParameterType.INT },
          height: { type: ParameterType.INT },
          top: { type: ParameterType.INT },
          bottom: { type: ParameterType.INT },
          left: { type: ParameterType.INT },
          right: { type: ParameterType.INT },
        },
      },
      /**
       * What is known about the timing of the samples in `saccade_data`: `offset_ms` is the
       * display + camera lag measured by the `saccade-time-sync` plugin (`null` if it was never
       * run), `corrected` says whether that offset was subtracted from `t`, `clock` is the clock
       * the camera timestamps came from (`captureTime` is the good one), `dropped_frames` is the
       * number of camera frames the browser reported dropping during the trial, `fps` is the
       * frame rate of the tracker at the end of the trial, and `tta` is the size of the
       * test-time-augmentation ring buffer the predictions were smoothed over.
       */
      saccade_timing: {
        type: ParameterType.COMPLEX,
        nested: {
          offset_ms: { type: ParameterType.FLOAT },
          corrected: { type: ParameterType.BOOL },
          clock: { type: ParameterType.STRING },
          dropped_frames: { type: ParameterType.INT },
          fps: { type: ParameterType.FLOAT },
          tta: { type: ParameterType.INT },
        },
      },
    },
    // prettier-ignore
    citations: '__CITATIONS__',
  };

  constructor(private jsPsych: JsPsych) {}

  // ---- configuration -------------------------------------------------------------------------
  private round_predictions = true;
  private tta = 5;
  private assets: SaccadeAssets = {};

  // ---- tracker state -------------------------------------------------------------------------
  private tracker: SaccadeTracker | null = null;
  private initialized = false;
  private starting: Promise<void> | null = null;
  private backend: string | null = null;
  private frameUnsubscribe: (() => void) | null = null;
  private faceFound = false;

  // ---- per-trial state -----------------------------------------------------------------------
  private currentTrialData: SaccadeGazeSample[] = [];
  private currentTrialTargets: Record<string, SaccadeTargetRect> = {};
  private currentTrialSelectors: Array<string> = [];
  private currentTrialStart = 0;
  private trialUnsubscribe: (() => void) | null = null;
  private trialDroppedFrames = 0;
  private activeTrial = false;
  private domObserver: MutationObserver | null = null;

  // ---- gaze / timing state -------------------------------------------------------------------
  private gazeUpdateCallbacks: Array<(sample: SaccadeGazeSample) => void> = [];
  private currentGaze: SaccadeGazeSample | null = null;
  private lastClock: FrameTime["source"] | null = null;
  private lastFps: number | null = null;
  private timingOffset: number | null = null;
  private lastLoopback: LoopbackResult | null = null;

  // ---- DOM overlays --------------------------------------------------------------------------
  private videoContainer: HTMLDivElement | null = null;
  private gazeDot: HTMLDivElement | null = null;
  private predictionsVisible = false;

  // =============================================================================================
  // jsPsych extension lifecycle
  // =============================================================================================

  initialize = async ({
    round_predictions = true,
    auto_initialize = false,
    tta = 5,
    assets = {},
    tracker,
  }: InitializeParameters = {}): Promise<void> => {
    this.round_predictions = round_predictions;
    this.tta = tta;
    this.assets = assets;
    this.gazeUpdateCallbacks = [];

    if (tracker) {
      this.tracker = tracker;
    }

    if (typeof MutationObserver !== "undefined") {
      this.domObserver = new MutationObserver(this.mutationObserverCallback);
    }

    if (auto_initialize) {
      await this.start();
    }
  };

  on_start = (params?: OnStartParameters): void => {
    this.currentTrialData = [];
    this.currentTrialTargets = {};
    this.currentTrialSelectors = params?.targets ?? [];
    this.trialDroppedFrames = 0;

    this.domObserver?.observe(this.jsPsych.getDisplayElement(), { childList: true, subtree: true });
  };

  on_load = (): void => {
    this.currentTrialStart = performance.now();
    this.activeTrial = true;

    // Record whatever targets are already in the DOM at load time; the observer picks up the rest.
    this.recordTargets();

    if (this.tracker) {
      if (!this.tracker.running) {
        this.tracker.start();
      }
      // Per-trial sampling: subscribe for the duration of the trial only.
      this.trialUnsubscribe = this.tracker.onFrame(this.handleTrialFrame);
    }
  };

  on_finish = (): {
    saccade_data: SaccadeGazeSample[];
    saccade_targets: Record<string, SaccadeTargetRect>;
    saccade_timing: SaccadeTimingInfo;
  } => {
    this.trialUnsubscribe?.();
    this.trialUnsubscribe = null;

    this.recordTargets();
    this.domObserver?.disconnect();

    this.activeTrial = false;

    return {
      saccade_data: this.currentTrialData,
      saccade_targets: this.currentTrialTargets,
      saccade_timing: {
        offset_ms: this.timingOffset,
        corrected: this.timingOffset !== null,
        clock: this.lastClock,
        dropped_frames: this.trialDroppedFrames,
        fps: this.lastFps,
        tta: this.tta,
      },
    };
  };

  // =============================================================================================
  // public API
  // =============================================================================================

  /**
   * Build the tracker if necessary, request the camera, load the models, and start the frame
   * loop. Idempotent, and safe to call concurrently: the same promise is returned.
   */
  start = (): Promise<void> => {
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const tracker = this.getTracker();
      const { ep } = await tracker.init();
      this.backend = ep;
      this.frameUnsubscribe ??= tracker.onFrame(this.handleFrame);
      tracker.start();
      this.initialized = true;
    })();
    this.starting.catch(() => {
      // Allow a retry after a failure (e.g. the participant denied the camera the first time).
      this.starting = null;
    });
    return this.starting;
  };

  /** Stop processing camera frames. The camera stream stays open. */
  pause = (): void => {
    this.tracker?.stop();
    this.setGazeDot(null);
  };

  /** Resume processing camera frames after `pause()`. */
  resume = (): void => {
    this.tracker?.start();
  };

  /** Whether `start()` has completed successfully. */
  isInitialized = (): boolean => this.initialized;

  /** Whether the most recent camera frame contained a face. */
  faceDetected = (): boolean => this.faceFound;

  /** The execution provider the ONNX model is running on (`"webgpu"` or `"wasm"`). */
  getBackend = (): string | null => this.backend;

  /** Show the small mirrored camera preview in the bottom-left corner. */
  showVideo = (): void => {
    this.injectStyle();
    const container = this.ensureVideoContainer();
    const tracker = this.tracker;
    if (tracker && tracker.video && tracker.video.parentElement !== container) {
      container.appendChild(tracker.video);
    }
    container.style.display = "";
  };

  /** Hide the camera preview. */
  hideVideo = (): void => {
    if (this.videoContainer) this.videoContainer.style.display = "none";
  };

  /** Show a dot at the current gaze prediction. */
  showPredictions = (): void => {
    this.injectStyle();
    this.ensureGazeDot();
    this.predictionsVisible = true;
    if (this.currentGaze) this.setGazeDot(this.currentGaze);
  };

  /** Hide the gaze prediction dot. */
  hidePredictions = (): void => {
    this.predictionsVisible = false;
    this.gazeDot?.classList.remove("saccade-visible");
  };

  /** Throw away all calibration points and the fitted model. */
  resetCalibration = (): void => {
    this.tracker?.clearCalibration();
  };

  /**
   * Add one calibration point at the given viewport pixel coordinates. If `embeddings` is
   * omitted, embeddings are collected from the camera for `captureMs` milliseconds first.
   *
   * @param x Horizontal position of the target, in pixels from the left of the viewport.
   * @param y Vertical position of the target, in pixels from the top of the viewport.
   * @param embeddings Pre-collected embeddings for this point. Omit to collect them now.
   * @param captureMs How long to collect embeddings for when `embeddings` is omitted.
   * @returns The number of embeddings recorded for the point (0 if none could be collected).
   */
  calibratePoint = async (
    x: number,
    y: number,
    embeddings?: Float32Array[],
    captureMs = 500,
  ): Promise<number> => {
    const tracker = this.getTracker();
    const target = {
      x: x / this.viewportWidth(),
      y: y / this.viewportHeight(),
    };

    let collected = embeddings;
    if (!collected) {
      collected = [];
      const until = performance.now() + captureMs;
      while (performance.now() < until) {
        const e = await tracker.nextEmbedding();
        if (e) collected.push(e);
      }
    }
    if (collected.length === 0) return 0;
    tracker.addCalibrationPoint(target, collected);
    return collected.length;
  };

  /**
   * Fit the ridge regression from the calibration points collected so far.
   *
   * @param lambda Ridge penalty. Omit to let the core pick one with `lambdaFor(nPoints)`.
   */
  fitCalibration = (lambda?: number): { lambda: number; nPoints: number } | null => {
    const tracker = this.getTracker();
    return tracker.fitCalibration(lambda === undefined || lambda === null ? undefined : { lambda });
  };

  /** The calibration points collected so far (targets in viewport fractions, 0–1). */
  getCalibrationPoints = (): CalPoint[] => this.tracker?.getCalibrationPoints() ?? [];

  /** The most recent gaze prediction in viewport pixels, or `null` if there isn't one. */
  getCurrentPrediction = (): SaccadeGazeSample | null => this.currentGaze;

  /**
   * Subscribe to gaze predictions.
   *
   * @returns A function that removes the subscription.
   */
  onGazeUpdate = (callback: (sample: SaccadeGazeSample) => void): (() => void) => {
    this.gazeUpdateCallbacks.push(callback);
    return () => {
      this.gazeUpdateCallbacks = this.gazeUpdateCallbacks.filter((item) => item !== callback);
    };
  };

  /** The underlying `SaccadeTracker`, constructing it if it does not exist yet. */
  getTracker = (): SaccadeTracker => {
    this.tracker ??= new SaccadeTracker({ assets: this.assets, tta: this.tta });
    return this.tracker;
  };

  /** The measured display + camera lag in ms, or `null` if it was never measured. */
  getTimingOffset = (): number | null => this.timingOffset;

  /** Set (or clear, with `null`) the display + camera lag subtracted from every sample's `t`. */
  setTimingOffset = (ms: number | null): void => {
    this.timingOffset = ms;
  };

  /** The full result of the most recent timing loopback run, or `null`. */
  getLastLoopback = (): LoopbackResult | null => this.lastLoopback;

  /**
   * Store a loopback result so later trials can report it. Called by the `saccade-time-sync`
   * plugin; not part of the WebGazer-compatible surface.
   */
  setLastLoopback = (result: LoopbackResult | null): void => {
    this.lastLoopback = result;
  };

  // =============================================================================================
  // internals
  // =============================================================================================

  /** Persistent per-frame handler: overlays, the current prediction, and subscriber callbacks. */
  private handleFrame = (frame: TrackerFrame): void => {
    this.faceFound = frame.faceFound;
    this.lastClock = frame.time.source;
    this.lastFps = frame.fps;

    const sample = this.toSample(frame);
    this.currentGaze = sample;
    this.setGazeDot(sample);
    if (sample) {
      for (const cb of this.gazeUpdateCallbacks) cb(sample);
    }
  };

  /** Trial-scoped per-frame handler: fills `saccade_data` and counts dropped frames. */
  private handleTrialFrame = (frame: TrackerFrame): void => {
    this.lastClock = frame.time.source;
    this.lastFps = frame.fps;
    if (frame.time.dropped != null) this.trialDroppedFrames += frame.time.dropped;
    const sample = this.toSample(frame);
    if (sample) this.currentTrialData.push(sample);
  };

  /** Convert a tracker frame into a viewport-pixel sample, or `null` if there is no gaze. */
  private toSample = (frame: TrackerFrame): SaccadeGazeSample | null => {
    if (!frame.faceFound || !frame.gaze) return null;
    const x = frame.gaze.x * this.viewportWidth();
    const y = frame.gaze.y * this.viewportHeight();
    // The gaze is the mean over the TTA ring buffer, so it refers to the buffer's mean capture
    // time, not the newest frame's.
    const capture = frame.time.meanCapture ?? frame.time.capture;
    const t = capture - (this.activeTrial ? this.currentTrialStart : 0) - (this.timingOffset ?? 0);
    return {
      x: this.round_predictions ? Math.round(x) : x,
      y: this.round_predictions ? Math.round(y) : y,
      t: Math.round(t),
    };
  };

  private recordTargets = (): void => {
    const display = this.jsPsych.getDisplayElement();
    if (!display) return;
    for (const selector of this.currentTrialSelectors) {
      if (this.currentTrialTargets[selector]) continue;
      const el = display.querySelector(selector);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      this.currentTrialTargets[selector] = {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
      };
    }
  };

  private mutationObserverCallback = (): void => {
    this.recordTargets();
  };

  private setGazeDot(sample: SaccadeGazeSample | null): void {
    if (!this.predictionsVisible || !this.gazeDot) return;
    if (!sample) {
      this.gazeDot.classList.remove("saccade-visible");
      return;
    }
    this.gazeDot.style.transform = `translate(${sample.x}px, ${sample.y}px)`;
    this.gazeDot.classList.add("saccade-visible");
  }

  private injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  private ensureVideoContainer(): HTMLDivElement {
    if (!this.videoContainer) {
      const container = document.createElement("div");
      container.id = VIDEO_CONTAINER_ID;
      container.style.width = "160px";
      document.body.appendChild(container);
      this.videoContainer = container;
    }
    return this.videoContainer;
  }

  private ensureGazeDot(): HTMLDivElement {
    if (!this.gazeDot) {
      const dot = document.createElement("div");
      dot.id = GAZE_DOT_ID;
      document.body.appendChild(dot);
      this.gazeDot = dot;
    }
    return this.gazeDot;
  }

  private viewportWidth(): number {
    return window.innerWidth || document.documentElement.clientWidth || 1;
  }

  private viewportHeight(): number {
    return window.innerHeight || document.documentElement.clientHeight || 1;
  }
}

export default SaccadeExtension;
