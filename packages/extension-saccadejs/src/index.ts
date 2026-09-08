import { JsPsych, JsPsychExtension, JsPsychExtensionInfo, ParameterType } from "jspsych";
import { DEFAULT_FRAME_TIMEOUT_MS, SaccadeTracker, withFrameTimeout } from "@saccadejs/core";
import type {
  CalPoint,
  FrameTime,
  LoopbackResult,
  SaccadeAssets,
  SaccadeProgress,
  SaccadeProgressCallback,
  TrackerFrame,
} from "@saccadejs/core";

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
  smoothing_frames: number;
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
   * How many consecutive camera frames are averaged into one gaze estimate. The default of 1
   * predicts from the newest frame alone, which is the lowest latency and the only sane setting
   * for a gaze-contingent design. Larger values are steadier but lag: the reported gaze then
   * refers to a moment roughly `(n − 1) / 2` frames in the past.
   * @default 1
   */
  smoothing_frames?: number;
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
  width: 160px;
  z-index: 2147483646;
  line-height: 0;
  border-radius: 6px;
  overflow: hidden;
  background: #000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}
/* Hidden, but still rendered: Chrome delivers camera frames only for a video element that is
   in the document and not display:none / visibility:hidden, so hiding the preview that way
   would stop the tracker dead. Two invisible pixels in the corner cost nothing. */
#${VIDEO_CONTAINER_ID}.saccade-hidden {
  width: 2px;
  height: 2px;
  bottom: 0;
  left: 0;
  opacity: 0;
  pointer-events: none;
  box-shadow: none;
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
 * The saccade.js jsPsych extension. Add it to
 * `initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] })`, then opt individual trials
 * in with `extensions: [{ type: jsPsychExtensionSaccade, params: { targets: [...] } }]`.
 *
 * @see {@link https://saccade.jspsych.org/reference/extension/ saccade.js: the jsPsych extension}
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
       * frame rate of the tracker at the end of the trial, and `smoothing_frames` is the
       * number of camera frames each prediction was actually averaged over — the tracker's own
       * setting, which need not be the `smoothing_frames` parameter.
       */
      saccade_timing: {
        type: ParameterType.COMPLEX,
        nested: {
          offset_ms: { type: ParameterType.FLOAT },
          corrected: { type: ParameterType.BOOL },
          clock: { type: ParameterType.STRING },
          dropped_frames: { type: ParameterType.INT },
          fps: { type: ParameterType.FLOAT },
          smoothing_frames: { type: ParameterType.INT },
        },
      },
    },
    // prettier-ignore
    citations: '__CITATIONS__',
  };

  constructor(private jsPsych: JsPsych) {}

  // ---- configuration -------------------------------------------------------------------------
  private round_predictions = true;
  private smoothing_frames = 1;
  private assets: SaccadeAssets = {};

  // ---- tracker state -------------------------------------------------------------------------
  private tracker: SaccadeTracker | null = null;
  /** False for a tracker handed in through the `tracker` parameter: `dispose()` leaves it alone. */
  private ownsTracker = false;
  private initialized = false;
  private starting: Promise<void> | null = null;
  private backend: string | null = null;
  private frameUnsubscribe: (() => void) | null = null;
  private faceFound = false;
  /** So the "you never started the tracker" warning is printed once, not once per trial. */
  private warnedNotStarted = false;

  // ---- setup progress ------------------------------------------------------------------------
  private progressCallbacks: Array<SaccadeProgressCallback> = [];
  private lastProgress: SaccadeProgress | null = null;

  // ---- per-trial state -----------------------------------------------------------------------
  private currentTrialData: SaccadeGazeSample[] = [];
  private currentTrialTargets: Record<string, SaccadeTargetRect> = {};
  private currentTrialSelectors: Array<string> = [];
  private currentTrialStart = 0;
  private trialUnsubscribe: (() => void) | null = null;
  private trialDroppedFrames = 0;
  private activeTrial = false;
  private domObserver: MutationObserver | null = null;
  /** True while some requested target still has no rect worth recording. See `recordTargets`. */
  private targetsPending = false;

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
    smoothing_frames = 1,
    assets = {},
    tracker,
  }: InitializeParameters = {}): Promise<void> => {
    this.round_predictions = round_predictions;
    this.smoothing_frames = smoothing_frames;
    this.assets = assets;
    this.gazeUpdateCallbacks = [];

    if (tracker) {
      this.tracker = tracker;
      this.ownsTracker = false;
      this.parkVideo();
      this.watchFrames();
    }

    if (typeof MutationObserver !== "undefined") {
      this.domObserver = new MutationObserver(this.mutationObserverCallback);
    }
  };

  on_start = (params?: OnStartParameters): void => {
    this.currentTrialData = [];
    this.currentTrialTargets = {};
    this.currentTrialSelectors = params?.targets ?? [];
    this.targetsPending = this.currentTrialSelectors.length > 0;
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
    } else {
      this.warnNotStarted();
    }
  };

  on_finish = (): {
    saccade_data: SaccadeGazeSample[];
    saccade_targets: Record<string, SaccadeTargetRect>;
    saccade_timing: SaccadeTimingInfo;
  } => {
    this.trialUnsubscribe?.();
    this.trialUnsubscribe = null;

    // No `recordTargets()` here: jsPsych empties the display element in `cleanupTrial()`, which
    // runs *before* an extension's `on_finish`, so by now there is nothing left to measure.
    // Everything must have been recorded while the trial was on screen.
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
        // What the tracker was actually smoothing over, not what this extension was asked for:
        // a tracker supplied through the `tracker` parameter carries its own setting, and it
        // can be changed at any time with `setSmoothingFrames`.
        smoothing_frames: this.tracker?.getSmoothingFrames() ?? this.smoothing_frames,
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
      this.watchFrames();
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
    const container = this.claimVideo();
    container.classList.remove("saccade-hidden");
  };

  /**
   * Hide the camera preview.
   *
   * The video element is taken back into the extension's own container and made invisible
   * there; it is never `display: none`d or detached, because Chrome only delivers camera
   * frames for a video that is actually rendered. Hiding it any other way stops the tracker.
   */
  hideVideo = (): void => {
    const container = this.claimVideo();
    container.classList.add("saccade-hidden");
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
   * @param timeoutMs How long to wait for a single camera frame before rejecting with `no
   *   camera frames for <ms> ms`. Without it a dead frame source freezes the trial silently.
   * @returns The number of embeddings recorded for the point (0 if none could be collected).
   */
  calibratePoint = async (
    x: number,
    y: number,
    embeddings?: Float32Array[],
    captureMs = 500,
    timeoutMs = DEFAULT_FRAME_TIMEOUT_MS,
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
        const e = await withFrameTimeout(tracker.nextEmbedding(), timeoutMs);
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
    if (!this.tracker) {
      this.tracker = new SaccadeTracker({
        assets: this.assets,
        smoothingFrames: this.smoothing_frames,
        onProgress: this.handleProgress,
      });
      this.ownsTracker = true;
      this.parkVideo();
      this.watchFrames();
    }
    return this.tracker;
  };

  /**
   * Subscribe to the load progress of `start()` — camera permission, MediaPipe, the
   * face-landmarker task, onnxruntime-web, the ~20 MB eye model, and the warm-up — so a trial
   * can show a progress bar instead of a blank wait. The most recent report (if any) is
   * delivered synchronously on subscribe, so a late subscriber is not left with an empty bar.
   *
   * A tracker supplied through the `tracker` initialize parameter was constructed by the page,
   * which owns its `onProgress`; nothing is reported for it here.
   *
   * @returns A function that removes the subscription.
   */
  onSetupProgress = (callback: SaccadeProgressCallback): (() => void) => {
    this.progressCallbacks.push(callback);
    if (this.lastProgress) {
      try {
        callback(this.lastProgress);
      } catch {
        // A broken listener must not take the caller down with it.
      }
    }
    return () => {
      this.progressCallbacks = this.progressCallbacks.filter((item) => item !== callback);
    };
  };

  /** The most recent setup progress report, or `null` if `start()` has not begun. */
  getSetupProgress = (): SaccadeProgress | null => this.lastProgress;

  /**
   * Tear down everything the extension put on the page: the frame subscriptions, the camera
   * preview container, the gaze dot, and — unless the tracker was handed in through the
   * `tracker` initialize parameter — the tracker itself, which releases the camera.
   *
   * jsPsych has no extension teardown hook, so an application that ends an experiment and
   * starts another (a demo page with a "run again" button, a React route change) has to call
   * this itself. The extension is left in its pre-`start()` state, so a later `start()` builds
   * a fresh tracker rather than reusing a disposed one.
   */
  dispose = (): void => {
    this.trialUnsubscribe?.();
    this.trialUnsubscribe = null;
    this.frameUnsubscribe?.();
    this.frameUnsubscribe = null;
    // Disconnected, not discarded: a MutationObserver is reusable, and `initialize` is the only
    // place one is built, so throwing it away would leave a re-started extension without one.
    this.domObserver?.disconnect();

    if (this.tracker) {
      if (this.ownsTracker) this.tracker.dispose();
      else this.tracker.stop();
    }
    this.tracker = null;
    this.ownsTracker = false;
    this.initialized = false;
    this.starting = null;
    this.backend = null;
    this.warnedNotStarted = false;
    this.faceFound = false;
    this.currentGaze = null;
    this.lastProgress = null;
    this.progressCallbacks = [];
    this.gazeUpdateCallbacks = [];

    this.gazeDot?.remove();
    this.gazeDot = null;
    this.predictionsVisible = false;
    this.videoContainer?.remove();
    this.videoContainer = null;
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
   * plugin.
   */
  setLastLoopback = (result: LoopbackResult | null): void => {
    this.lastLoopback = result;
  };

  // =============================================================================================
  // internals
  // =============================================================================================

  /**
   * Warn, once, that a trial opted into the extension before anything started the camera. The
   * trial records nothing in that case, and a silently empty `saccade_data` is a hard thing to
   * debug after the fact.
   */
  private warnNotStarted(): void {
    if (this.warnedNotStarted) return;
    this.warnedNotStarted = true;
    console.warn(
      "saccade: a trial is recording gaze, but the camera has not been started, so " +
        "`saccade_data` will be empty. Run a `saccade-preview` trial before the first recording " +
        "trial, or call `jsPsych.extensions.saccade.start()` yourself.",
    );
  }

  /** Fan the tracker's load progress out to `onSetupProgress` subscribers. */
  private handleProgress = (p: SaccadeProgress): void => {
    this.lastProgress = p;
    for (const cb of Array.from(this.progressCallbacks)) {
      try {
        cb(p);
      } catch {
        // Progress is a UI convenience; a broken listener must not fail init.
      }
    }
  };

  /**
   * Subscribe the persistent frame handler, unless it is already subscribed.
   *
   * Everything the extension offers outside a trial — `getCurrentPrediction`, `onGazeUpdate`,
   * `faceDetected` and the gaze dot — is fed from `handleFrame`, so the subscription has to
   * follow the *tracker*, not `start()`. An experiment that supplies its own tracker through the
   * `tracker` parameter and never runs `saccade-preview` never calls `start()`, and everything
   * on that list used to go quietly dead: `saccade-validate`, which collects its samples through
   * `onGazeUpdate`, would record nothing at all and report an empty validation.
   */
  private watchFrames = (): void => {
    if (this.tracker && !this.frameUnsubscribe) {
      this.frameUnsubscribe = this.tracker.onFrame(this.handleFrame);
    }
  };

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
    // Cheap once every target has a box: the flag is false and this does nothing for the rest of
    // the trial. Until then it is the only hook that runs after an image lays out and before
    // jsPsych tears the display down.
    if (this.targetsPending) this.recordTargets();
    const sample = this.toSample(frame);
    if (sample) this.currentTrialData.push(sample);
  };

  /** Convert a tracker frame into a viewport-pixel sample, or `null` if there is no gaze. */
  private toSample = (frame: TrackerFrame): SaccadeGazeSample | null => {
    if (!frame.faceFound || !frame.gaze) return null;
    const x = frame.gaze.x * this.viewportWidth();
    const y = frame.gaze.y * this.viewportHeight();
    // The gaze is the mean over the smoothing ring buffer, so it refers to the buffer's mean
    // capture time, not the newest frame's.
    const capture = frame.time.meanCapture ?? frame.time.capture;
    const t = capture - (this.activeTrial ? this.currentTrialStart : 0) - (this.timingOffset ?? 0);
    return {
      x: this.round_predictions ? Math.round(x) : x,
      y: this.round_predictions ? Math.round(y) : y,
      t: Math.round(t),
    };
  };

  /**
   * Measure whichever requested targets can be measured, and remember which cannot yet.
   *
   * The first rect wins, but only if it is a rect: an element with zero width *and* zero height
   * has no layout box yet, which is the normal state of an `<img>` that is in the DOM but whose
   * bitmap has not arrived. Recording that would freeze a `0 x 0` box into the data and make the
   * trial's gaze impossible to hit-test, so a degenerate rect leaves the target outstanding and
   * the next call tries again.
   *
   * An image getting its box is a layout change, not a DOM change, so the mutation observer never
   * sees it. `handleTrialFrame` is what retries — it fires on every camera frame, which is both
   * during the trial and often enough to catch the box within a frame or two of it appearing.
   */
  private recordTargets = (): void => {
    const display = this.jsPsych.getDisplayElement();
    if (!display) return;
    let pending = false;
    for (const selector of this.currentTrialSelectors) {
      const recorded = this.currentTrialTargets[selector];
      if (recorded && (recorded.width > 0 || recorded.height > 0)) continue;
      const el = display.querySelector(selector);
      if (!el) {
        // Not on the page yet. It may still be added: the observer and the frame handler both
        // call back in.
        pending = true;
        continue;
      }
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
      if (r.width === 0 && r.height === 0) pending = true;
    }
    this.targetsPending = pending;
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
      // Reuse an existing container if one is already on the page (a second extension
      // instance, a re-initialised jsPsych): two elements with the same id, one of them
      // holding the video, is a good way to end up hiding the wrong one.
      const existing = document.getElementById(VIDEO_CONTAINER_ID) as HTMLDivElement | null;
      const container = existing ?? document.createElement("div");
      container.id = VIDEO_CONTAINER_ID;
      container.classList.add("saccade-hidden");
      this.videoContainer = container;
    }
    if (!this.videoContainer.isConnected) document.body.appendChild(this.videoContainer);
    return this.videoContainer;
  }

  /**
   * Put the camera element in the hidden container if it is not in the document at all.
   *
   * Done as soon as a tracker exists, so an experiment that never runs `saccade-preview` (and
   * therefore never calls `showVideo`) still gets camera frames: the tracker's `<video>` has to
   * be rendered somewhere for Chrome to deliver them. A video the page has already placed
   * itself is left where it is.
   */
  private parkVideo(): void {
    const video = this.tracker?.video;
    if (!video || video.isConnected || typeof document === "undefined" || !document.body) return;
    this.injectStyle();
    this.ensureVideoContainer().appendChild(video);
  }

  /**
   * Move the tracker's video element into the extension's container and return it.
   *
   * Both `showVideo` and `hideVideo` do this, so a plugin that borrowed the element (the
   * preview plugin puts it in the jsPsych display) hands it back rather than leaving it to be
   * destroyed by the next `display_element.innerHTML = ""` — which would silently end the
   * camera frames for the rest of the experiment.
   */
  private claimVideo(): HTMLDivElement {
    this.injectStyle();
    const container = this.ensureVideoContainer();
    const video = this.tracker?.video;
    if (video && video.parentElement !== container) container.appendChild(video);
    return container;
  }

  private ensureGazeDot(): HTMLDivElement {
    if (!this.gazeDot) {
      // Reuse a dot already on the page, for the same reason as the video container: a second
      // extension instance (a re-initialised jsPsych) must not leave two elements sharing an id.
      const existing = document.getElementById(GAZE_DOT_ID) as HTMLDivElement | null;
      const dot = existing ?? document.createElement("div");
      dot.id = GAZE_DOT_ID;
      this.gazeDot = dot;
    }
    if (!this.gazeDot.isConnected) document.body.appendChild(this.gazeDot);
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
