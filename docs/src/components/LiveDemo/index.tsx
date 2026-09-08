import React, { useCallback, useEffect, useRef, useState } from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";
import Head from "@docusaurus/Head";
import useBaseUrl from "@docusaurus/useBaseUrl";
import clsx from "clsx";
import type { JsPsych } from "jspsych";
import type { SaccadeTracker } from "@saccadejs/core";
import type SaccadeExtension from "@saccadejs/extension";
import FreeViewing from "./FreeViewing";
import { detectFixations, drawScanpath, type Fixation, type Rect, type Sample } from "./scanpath";
import styles from "./styles.module.css";

/**
 * The live demo on `/demo`.
 *
 * Four things saccade.js can do, offered as a menu rather than as a fixed four-minute run:
 * calibrate, check the accuracy of that calibration, record a scanpath over a painting, and
 * watch gaze live with the knobs exposed. Only calibration is available at the start, because
 * the other three have nothing to show without a fitted model, and any of them can be repeated
 * as often as the visitor likes.
 *
 * Three of the four are **real jsPsych trials**: the published extension and the published
 * plugins, on a timeline that would work unchanged in a study, rendered into a container on this
 * page with `initJsPsych({ display_element })`. Nothing about the eye tracking is reimplemented
 * here, so the demo cannot quietly drift away from the documentation. The fourth, free viewing,
 * is deliberately not a jsPsych trial: it drives the same `SaccadeTracker` straight from React,
 * which is what a page outside jsPsych does.
 *
 * One tracker serves all four. React owns it — `initJsPsych` is handed it through the
 * extension's `tracker` parameter — so the camera is opened once and the calibration survives
 * from one activity to the next. Each activity is its own short `jsPsych.run`, and the results
 * are lifted out of its data afterwards and kept here.
 *
 * The one thing a study does that the menu does not offer is `saccade-time-sync`, which measures
 * this computer's screen-to-camera lag so gaze can be lined up with stimulus timing. Nothing
 * here depends on it, and it costs a visitor a minute on a measurement they never see.
 * Experiments that care about *when* someone looked still need it — see `Timing and synchrony`.
 *
 * Everything the experiment touches — `navigator.mediaDevices`, WebGPU/WebAssembly, a `<video>`
 * element — is absent while Docusaurus prerenders this page to static HTML, so the component is
 * wrapped in `<BrowserOnly>` and every saccade.js/jsPsych module is pulled in with a dynamic
 * `import()` from inside a callback, never at module scope.
 */

/** How long the painting stays on screen. Long enough for a scanpath with a shape to it. */
const SCENE_MS = 15000;

/** A fixation has to last at least this long. Four or five frames at a webcam's 30 Hz. */
const FIXATION_MIN_MS = 150;

// ---------------------------------------------------------------------------------------
// the modules the activities are built from

interface Modules {
  initJsPsych: typeof import("jspsych").initJsPsych;
  SaccadeTracker: typeof import("@saccadejs/core").SaccadeTracker;
  extension: typeof import("@saccadejs/extension").default;
  preview: typeof import("@saccadejs/plugin-preview").default;
  calibrate: typeof import("@saccadejs/plugin-calibrate").default;
  validate: typeof import("@saccadejs/plugin-validate").default;
  button: typeof import("@jspsych/plugin-html-button-response").default;
  keyboard: typeof import("@jspsych/plugin-html-keyboard-response").default;
}

let modulesPromise: Promise<Modules> | null = null;

/**
 * Import jsPsych, the extension and the plugins, once per page load.
 *
 * All of it reaches for the camera, WebGPU or the DOM at import time, so none of it may be
 * pulled in at module scope — this page is prerendered in Node.
 */
function loadModules(): Promise<Modules> {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import("jspsych"),
      import("@saccadejs/core"),
      import("@saccadejs/extension"),
      import("@saccadejs/plugin-preview"),
      import("@saccadejs/plugin-calibrate"),
      import("@saccadejs/plugin-validate"),
      import("@jspsych/plugin-html-button-response"),
      import("@jspsych/plugin-html-keyboard-response"),
    ]).then(([jspsych, core, extension, preview, calibrate, validate, button, keyboard]) => ({
      initJsPsych: jspsych.initJsPsych,
      SaccadeTracker: core.SaccadeTracker,
      extension: extension.default,
      preview: preview.default,
      calibrate: calibrate.default,
      validate: validate.default,
      button: button.default,
      keyboard: keyboard.default,
    }));
    modulesPromise.catch(() => {
      modulesPromise = null;
    });
  }
  return modulesPromise;
}

// ---------------------------------------------------------------------------------------
// the screens jsPsych renders

/** Wrap instruction copy in the markup the instruction screens share. */
function instructions(heading: string, body: string): string {
  return `<div class="demo-prose"><h2>${heading}</h2>${body}</div>`;
}

const CALIBRATE_INSTRUCTIONS = instructions(
  "Calibration",
  `<p>A dot will appear on the screen, hold for a moment, then jump somewhere else — thirteen
  dots in all, about twenty seconds.</p>
  <ul>
    <li>Look straight at each dot as soon as it appears, and keep looking until it moves.</li>
    <li>Move your eyes, not your head. Hold your head still from here on.</li>
  </ul>`,
);

const VALIDATE_INSTRUCTIONS = instructions(
  "Accuracy check",
  `<p>Nine more dots, none of them in the places you calibrated on: look straight at each one as
  it appears, and keep your head still.</p>
  <p>Afterwards you will see where the tracker thought you were looking, point by point.</p>`,
);

const SCENE_INSTRUCTIONS = instructions(
  "Image scanpath",
  `<p>You will see a painting for about fifteen seconds. Look at it however you like — there is
  nothing to find, and nothing to press.</p>
  <p>Keep your head still, as you did for the dots.</p>`,
);

/**
 * The stimulus screens. Plain HTML strings with class names rather than JSX: jsPsych renders
 * these inside its own display element, so they are styled by the `:global` rules at the foot of
 * this component's stylesheet.
 */
function sceneStimulus(src: string): string {
  const alt =
    "A painting of a man in a long coat entering a room, watched by a woman, two children and " +
    "a servant.";
  return `<div class="demo-figure">
    <img id="scene" class="demo-scene demo-scene-full" src="${src}" alt="${alt}" />
  </div>`;
}

function scanpathStimulus(src: string): string {
  return `<div class="demo-figure demo-figure-stacked">
    <img id="scanpath-scene" class="demo-scene" src="${src}" alt="" />
    <canvas id="scanpath-canvas" class="demo-overlay"></canvas>
  </div>
  <div class="demo-caption">
    <p class="demo-explain">Each circle is a fixation — somewhere your gaze stayed put — and the
    bigger ones are the ones you held longer. The lines between them are your saccades.</p>
    <p class="demo-legend"><span>start of the trial</span><i></i><span>end</span></p>
  </div>`;
}

// ---------------------------------------------------------------------------------------
// the scanpath figure

/**
 * How far apart samples may sit and still count as one fixation, in pixels.
 *
 * Scaled to this participant's own tracker rather than fixed, because a threshold tight enough to
 * be meaningful on a good calibration shatters a noisy one into dozens of one-sample fixations.
 *
 * The quantity to scale by is **precision**, not accuracy: `average_offset[].r` from the
 * validation trial, the median distance of a point's samples from their own mean. Accuracy
 * (`median_error_px`) measures how far the estimates sit from the target, which is a constant
 * offset that shifts a fixation without spreading it, and using it produces a threshold roughly
 * twice too generous — fixations then run to a 560 ms median, about double what free viewing
 * actually produces.
 *
 * Six times the precision was chosen against a real run: it yields fixations with a median around
 * 260 ms covering ~80% of the samples, which is where scene viewing sits. The clamp, in viewport
 * heights, keeps a wild validation result from producing a single fixation over the whole picture
 * or none at all. A visitor who skipped the accuracy check gets the fallback in the middle of
 * that range, which is the honest thing to do with an unmeasured tracker.
 */
function dispersionFor(precisionPx: number | null, viewportHeight: number): number {
  const scaled = precisionPx === null ? 0.06 * viewportHeight : 6 * precisionPx;
  return Math.max(0.02 * viewportHeight, Math.min(0.15 * viewportHeight, scaled));
}

/** The median of the validation trial's per-point precision, or null if it measured none. */
function precisionOf(validation: any): number | null {
  const offsets: Array<{ r?: number }> = validation?.average_offset ?? [];
  const values = offsets.map((o) => o?.r).filter((r): r is number => Number.isFinite(r));
  return median(values);
}

interface SceneTrial {
  saccade_data?: Sample[];
  saccade_targets?: Record<string, Rect>;
}

/**
 * Draw the scanpath over the copy of the painting on screen, and keep drawing it if the window
 * changes size. Returns the teardown for the resize listener.
 *
 * The samples were recorded in viewport pixels, but they are mapped through the rect the picture
 * occupied at the time rather than through the viewport, so the figure stays correct however the
 * page has moved since.
 */
function mountScanpath(
  display: HTMLElement,
  scene: SceneTrial,
  precisionPx: number | null,
): { fixations: Fixation[]; teardown: () => void } {
  const img = display.querySelector<HTMLImageElement>("#scanpath-scene");
  const canvas = display.querySelector<HTMLCanvasElement>("#scanpath-canvas");
  const samples = scene.saccade_data ?? [];
  const from = scene.saccade_targets?.["#scene"];

  // Without a rect for the picture there is no way to map the samples onto it, and without
  // samples there is nothing to map. Say so rather than leaving an unmarked painting on screen
  // looking like a scanpath with nothing in it.
  if (!img || !canvas || !from || !from.width || !from.height || samples.length === 0) {
    const caption = display.querySelector(".demo-explain");
    if (caption) {
      caption.textContent =
        "No gaze was recorded while the painting was on screen, so there is no scanpath to draw.";
    }
    return { fixations: [], teardown: () => {} };
  }

  const fixations = detectFixations(samples, {
    dispersion: dispersionFor(precisionPx, window.innerHeight),
    minDuration: FIXATION_MIN_MS,
  });

  const draw = () => {
    if (!img.clientWidth) return;
    drawScanpath(canvas, fixations, samples, {
      from,
      width: img.clientWidth,
      height: img.clientHeight,
    });
  };

  // The picture was on screen a moment ago so it is in the cache, but a cached image still has
  // no layout box until the frame after it is inserted.
  if (img.complete && img.naturalWidth) requestAnimationFrame(draw);
  else img.addEventListener("load", () => requestAnimationFrame(draw), { once: true });

  window.addEventListener("resize", draw);
  return { fixations, teardown: () => window.removeEventListener("resize", draw) };
}

// ---------------------------------------------------------------------------------------
// what the session remembers

/** The four things a visitor can choose. `explore` is the one that is not a jsPsych trial. */
type Activity = "calibrate" | "validate" | "scanpath" | "explore";

interface CalibrationResult {
  nPoints: number;
  lambda: number | null;
}

interface ValidationResult {
  errorPercent: number | null;
  errorPx: number | null;
  /** Median distance of a point's samples from their own mean: how scattered, not how wrong. */
  precisionPx: number | null;
}

interface ScanpathResult {
  samples: number;
  hz: number | null;
  fixations: number;
  medianFixationMs: number | null;
}

interface Session {
  calibration: CalibrationResult | null;
  validation: ValidationResult | null;
  scanpath: ScanpathResult | null;
  /** Facts about this machine, filled in as the activities that measure them run. */
  backend: string | null;
  fps: number | null;
  clock: string | null;
  /** Frames averaged per estimate: the tracker's own default until free viewing changes it. */
  smoothingFrames: number;
  /** Every trial from every activity so far, in the order they ran. */
  rows: any[];
}

const EMPTY_SESSION: Session = {
  calibration: null,
  validation: null,
  scanpath: null,
  backend: null,
  fps: null,
  clock: null,
  smoothingFrames: 1,
  rows: [],
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Fold one finished activity's data into the session.
 *
 * A fresh calibration invalidates whatever was measured against the old one, so the accuracy
 * check and the scanpath are cleared rather than left on screen describing a model that no
 * longer exists.
 */
function absorb(
  prev: Session,
  activity: Activity,
  jsPsych: JsPsych,
  fixations: Fixation[],
): Session {
  const data = jsPsych.data.get();
  const first = (trial_type: string): any => data.filter({ trial_type }).values()[0] ?? {};
  const next: Session = { ...prev, rows: [...prev.rows, ...data.values()] };

  const preview = first("saccade-preview");
  if (preview.backend) next.backend = preview.backend;
  if (Number.isFinite(preview.fps)) next.fps = preview.fps;

  if (activity === "calibrate") {
    const calibration = first("saccade-calibrate");
    next.calibration = {
      nPoints: calibration.n_points ?? 0,
      lambda: Number.isFinite(calibration.lambda) ? calibration.lambda : null,
    };
    next.validation = null;
    next.scanpath = null;
  }

  if (activity === "validate") {
    const validation = first("saccade-validate");
    next.validation = {
      errorPercent: Number.isFinite(validation.median_error_viewport)
        ? validation.median_error_viewport * 100
        : null,
      errorPx: Number.isFinite(validation.median_error_px) ? validation.median_error_px : null,
      precisionPx: precisionOf(validation),
    };
  }

  if (activity === "scanpath") {
    // By `demo_step` rather than by `trial_type`, so it keeps finding the free-viewing trial if
    // that is ever rebuilt on a different plugin.
    const scene = data.filter({ demo_step: "scene" }).values()[0] ?? ({} as any);
    const samples: Sample[] = scene.saccade_data ?? [];
    next.scanpath = {
      samples: samples.length,
      hz: samples.length ? samples.length / (SCENE_MS / 1000) : null,
      fixations: fixations.length,
      medianFixationMs: median(fixations.map((f) => f.duration)),
    };
    if (scene.saccade_timing?.clock) next.clock = scene.saccade_timing.clock;
    if (Number.isFinite(scene.saccade_timing?.fps)) next.fps = scene.saccade_timing.fps;
  }

  return next;
}

// ---------------------------------------------------------------------------------------
// errors

/** Turn whatever went wrong into one sentence a participant can act on. */
function explain(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/NotAllowed|Permission denied/i.test(message)) {
    return "The browser blocked access to the camera. Allow the camera for this site — the icon at the left of the address bar — and then try again. Nothing is uploaded; frames are processed and discarded on your computer.";
  }
  if (/NotFound|NotReadable|Device|Overconstrained/i.test(message)) {
    return "No usable camera was found. Connect a webcam, close any other program that might be using it, and try again.";
  }
  if (/no camera frames/i.test(message)) {
    return "The camera stopped sending frames part way through. Close anything else that might be using it, then try again.";
  }
  if (/eye_embedding|onnx|fetch|network|404|Failed to load/i.test(message)) {
    return "The eye-tracking model could not be downloaded. Check your internet connection and try again.";
  }
  return `Something went wrong: ${message}`;
}

// ---------------------------------------------------------------------------------------
// the demo itself

type Phase = "intro" | "menu" | "running" | "explore" | "error";

function Demo() {
  const modelUrl = useBaseUrl("/models/eye_embedding.onnx");
  const sceneUrl = useBaseUrl("/img/repin-unexpected-visitors.jpg");

  const containerRef = useRef<HTMLDivElement | null>(null);
  /** The one tracker every activity shares. Built on the first run; disposed on unmount. */
  const trackerRef = useRef<SaccadeTracker | null>(null);
  const jsPsychRef = useRef<JsPsych | null>(null);
  const extensionRef = useRef<SaccadeExtension | null>(null);
  /** Undoes whatever the scanpath trial attached to `window`; replaced on every run. */
  const scanpathTeardownRef = useRef<() => void>(() => {});
  /** Guards every `setState` after an await: the visitor may have navigated away mid-run. */
  const mountedRef = useRef(true);

  const [supported] = useState(
    () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia,
  );
  const [phase, setPhase] = useState<Phase>("intro");
  const [running, setRunning] = useState<Activity | null>(null);
  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [error, setError] = useState<string | null>(null);

  const calibrated = session.calibration !== null;

  /**
   * End the activity that is on screen, keeping the tracker and its calibration.
   *
   * jsPsych has no teardown hook of its own, so both halves have to be ended by hand:
   * `abortExperiment` unwinds the timeline (a no-op once it has finished) and the extension's
   * `dispose()` drops its frame subscriptions and removes the gaze dot and the camera holder it
   * put on the page. It does not dispose the tracker, because it did not create it.
   */
  const endActivity = useCallback(() => {
    scanpathTeardownRef.current();
    scanpathTeardownRef.current = () => {};
    const jsPsych = jsPsychRef.current;
    const extension = extensionRef.current;
    jsPsychRef.current = null;
    extensionRef.current = null;
    if (jsPsych) {
      try {
        jsPsych.abortExperiment();
      } catch {
        // Already finished, or never started: nothing to unwind.
      }
    }
    try {
      extension?.dispose?.();
    } catch {
      // Nothing here is worth failing an unmount over.
    }
    // `dispose()` took the camera element's holder with it, leaving the element detached and
    // therefore frameless. `start()` puts it back in the tracker's own holder at once rather
    // than at the next tick of the one-second watchdog; `stop()` then parks the frame loop,
    // because nobody is looking at a menu with their eyes tracked, and inference on every
    // camera frame is not a free thing to leave running. The next trial resumes it.
    const tracker = trackerRef.current;
    if (tracker?.initialized) {
      tracker.start();
      tracker.stop();
    }
    if (containerRef.current) containerRef.current.innerHTML = "";
  }, []);

  /** End everything and give the camera back. */
  const releaseCamera = useCallback(() => {
    endActivity();
    trackerRef.current?.dispose();
    trackerRef.current = null;
  }, [endActivity]);

  // Set on the way in as well as the way out, so a StrictMode double-mount does not leave the
  // component permanently marked as gone.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseCamera();
    };
  }, [releaseCamera]);

  /** Start the whole thing over: new tracker, no calibration, no data. */
  const reset = useCallback(() => {
    releaseCamera();
    setSession(EMPTY_SESSION);
    setError(null);
    setRunning(null);
    setPhase("intro");
  }, [releaseCamera]);

  /** Abandon an activity that cannot continue, and go back to the menu. */
  const abandon = useCallback(() => {
    endActivity();
    setError(null);
    setRunning(null);
    setPhase("menu");
  }, [endActivity]);

  const run = useCallback(
    async (activity: Activity) => {
      // Free viewing is not a jsPsych trial: it takes over the page itself, and it has nothing
      // to show without a tracker that has already been calibrated.
      if (activity === "explore") {
        if (trackerRef.current) setPhase("explore");
        return;
      }

      endActivity();
      setError(null);
      setRunning(activity);
      setPhase("running");

      // Start the painting downloading as soon as it might be wanted, so the trial that needs
      // it never waits on the network.
      if (activity === "scanpath") new Image().src = sceneUrl;

      try {
        const m = await loadModules();
        const display = containerRef.current;
        if (!mountedRef.current || !display) return;

        // The model is served from this site rather than the CDN; everything else (the
        // MediaPipe wasm, onnxruntime-web) comes from the defaults, as it would in an experiment
        // that has not been through `Hosting the assets`.
        const assets = { modelUrl };
        if (!trackerRef.current) trackerRef.current = new m.SaccadeTracker({ assets });
        const tracker = trackerRef.current;

        const jsPsych = m.initJsPsych({
          display_element: display,
          extensions: [{ type: m.extension, params: { tracker, assets } }],
          // The experiment sits in the middle of a documentation page. Every trial begins by
          // putting it where the participant can see all of it — gaze is recorded in viewport
          // coordinates, so a stage half off the bottom of the window would be recorded
          // honestly and read as nonsense.
          on_trial_start: () => display.scrollIntoView({ block: "center" }),
        });
        jsPsychRef.current = jsPsych;
        extensionRef.current = jsPsych.extensions.saccade as unknown as SaccadeExtension;

        // Set by the scanpath trial and read once the run is over: the figure the participant
        // saw and the fixation count in the summary have to be the same fixations.
        let fixations: Fixation[] = [];

        // Camera permission, the model download with its progress bar, and head positioning.
        // Only on the first activity of the session: after that the camera is already open, and
        // making somebody sit through a preview screen to recalibrate is friction for nothing.
        const setup = tracker.initialized ? [] : [{ type: m.preview }];

        const timelines: Record<Exclude<Activity, "explore">, any[]> = {
          calibrate: [
            ...setup,
            {
              type: m.button,
              stimulus: CALIBRATE_INSTRUCTIONS,
              choices: ["Begin calibration"],
            },
            // Fits the gaze model on 13 points. `clear_previous` defaults to true, so running
            // this a second time replaces the old calibration rather than adding to it.
            { type: m.calibrate },
          ],
          validate: [
            ...setup,
            { type: m.button, stimulus: VALIDATE_INSTRUCTIONS, choices: ["Begin accuracy check"] },
            // Nine held-out points, then the scatter of what was actually recorded at each one.
            // `show_validation_data` is meant for piloting, which is exactly what this is.
            { type: m.validate, show_validation_data: true },
          ],
          scanpath: [
            ...setup,
            { type: m.button, stimulus: SCENE_INSTRUCTIONS, choices: ["Begin"] },
            // An ordinary jsPsych trial; `extensions` is what turns recording on, and `targets`
            // records where the picture was, which is what the scanpath is drawn against.
            {
              type: m.keyboard,
              stimulus: sceneStimulus(sceneUrl),
              choices: "NO_KEYS",
              trial_duration: SCENE_MS,
              data: { demo_step: "scene" },
              extensions: [{ type: m.extension, params: { targets: ["#scene"] } }],
            },
            // The recorded trial, given back as a picture.
            {
              type: m.button,
              stimulus: scanpathStimulus(sceneUrl),
              choices: ["Back to the menu"],
              data: { demo_step: "scanpath" },
              on_load: () => {
                const scene = jsPsych.data.get().filter({ demo_step: "scene" }).values()[0] ?? {};
                scanpathTeardownRef.current();
                const mounted = mountScanpath(
                  display,
                  scene,
                  session.validation?.precisionPx ?? null,
                );
                fixations = mounted.fixations;
                scanpathTeardownRef.current = mounted.teardown;
              },
              on_finish: () => {
                scanpathTeardownRef.current();
                scanpathTeardownRef.current = () => {};
              },
            },
          ],
        };

        await jsPsych.run(timelines[activity]);
        if (!mountedRef.current || jsPsychRef.current !== jsPsych) return;

        setSession((prev) => absorb(prev, activity, jsPsych, fixations));
        endActivity();
        setRunning(null);
        setPhase("menu");
      } catch (err) {
        if (!mountedRef.current) return;
        setError(explain(err));
        setRunning(null);
        setPhase("error");
        endActivity();
      }
    },
    [endActivity, modelUrl, sceneUrl, session.validation],
  );

  const setSmoothing = useCallback((smoothingFrames: number) => {
    setSession((prev) => ({ ...prev, smoothingFrames }));
  }, []);

  return (
    <div className={styles.demo}>
      {phase === "intro" ? <Intro supported={supported} onStart={() => setPhase("menu")} /> : null}

      {phase === "error" && error ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorText}>{error}</p>
          <div className={styles.buttonRow}>
            <button className={styles.primary} onClick={() => setPhase("menu")}>
              Back to the menu
            </button>
          </div>
        </div>
      ) : null}

      {phase === "menu" || phase === "error" ? (
        <Menu session={session} calibrated={calibrated} onRun={run} onReset={reset} />
      ) : null}

      {/*
        jsPsych renders into this element for the whole of an activity. It stays mounted in
        every phase so that nothing React does can pull a running trial (or the tracker's
        <video>, which Chrome only delivers frames to while it is rendered) out from under it.
      */}
      <div
        ref={containerRef}
        className={clsx(styles.stage, phase !== "running" && styles.stageIdle)}
      />

      {/*
        The way out of a trial that cannot continue. A plugin handles its own failures — the
        preview trial prints "the eye tracker failed to start" and stops there, exactly as it
        would in a real experiment — so React cannot see them; this is the escape hatch for
        that, and for anyone who simply wants to stop half way through calibration.
      */}
      {phase === "running" ? (
        <p className={styles.abandonRow}>
          <button className={styles.abandon} onClick={abandon}>
            Stop {running === "calibrate" ? "calibrating" : "this"} and go back
          </button>
        </p>
      ) : null}

      {phase === "explore" && trackerRef.current ? (
        <FreeViewing
          tracker={trackerRef.current}
          smoothingFrames={session.smoothingFrames}
          onSmoothingChange={setSmoothing}
          onExit={() => setPhase("menu")}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// the screens React renders

function Intro({ supported, onStart }: { supported: boolean; onStart: () => void }) {
  return (
    <div className={clsx(styles.panel, styles.panelCentered)}>
      <p className={styles.lead}>
        Your webcam watches your eyes while you look at a handful of dots, and from that the page
        learns to guess where on the screen you are looking. Calibrating takes about a minute; after
        that you can check how accurate it is, record your own scanpath over a painting, or just
        watch the estimate move, in any order and as often as you like.
      </p>
      <p className={styles.lead}>
        Every camera frame is used and discarded on your own computer. Nothing is uploaded.
      </p>
      <ul className={styles.requirements}>
        <li>Chrome or Edge on a laptop or desktop</li>
        <li>A webcam, and permission to use it when the browser asks</li>
        <li>Sit about an arm's length from the screen</li>
        <li>Light on your face, not behind you — avoid sitting with a window at your back</li>
        <li>Keep your head still once calibration starts; move your eyes, not your head</li>
      </ul>
      {supported ? (
        <button className={styles.primary} onClick={onStart}>
          Start
        </button>
      ) : (
        <p className={styles.status}>
          This browser cannot open a camera on this page. Cameras need a secure connection — open
          the page over <code>https://</code> or on <code>localhost</code>.
        </p>
      )}
    </div>
  );
}

interface CardProps {
  title: string;
  cost: string;
  blurb: React.ReactNode;
  /** What this activity measured last time it ran, or null if it has not. */
  result: React.ReactNode;
  cta: string;
  disabled: boolean;
  onRun: () => void;
}

function Card({ title, cost, blurb, result, cta, disabled, onRun }: CardProps) {
  return (
    <div className={clsx(styles.card, disabled && styles.cardDisabled)}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{title}</h3>
        <span className={styles.cardCost}>{cost}</span>
      </div>
      <p className={styles.cardBlurb}>{blurb}</p>
      <div className={styles.cardResult}>
        {result ?? <span className={styles.cardPending}>Not run yet</span>}
      </div>
      <button className={styles.secondary} onClick={onRun} disabled={disabled}>
        {cta}
      </button>
    </div>
  );
}

function Menu({
  session,
  calibrated,
  onRun,
  onReset,
}: {
  session: Session;
  calibrated: boolean;
  onRun: (activity: Activity) => void;
  onReset: () => void;
}) {
  const { calibration, validation, scanpath } = session;

  return (
    <div className={styles.menu}>
      <div className={styles.cards}>
        <Card
          title="Calibration"
          cost="about a minute"
          blurb={
            <>
              Thirteen dots, one after another. The page fits a ridge regression from what your eyes
              look like to where you are looking — the only part of the model that is yours.
            </>
          }
          result={
            calibration ? (
              <>
                Fitted on {calibration.nPoints} points
                {calibration.lambda === null ? null : (
                  <span className={styles.cardAside}>λ = {calibration.lambda}</span>
                )}
              </>
            ) : null
          }
          cta={calibrated ? "Calibrate again" : "Calibrate"}
          disabled={false}
          onRun={() => onRun("calibrate")}
        />

        <Card
          title="Accuracy check"
          cost="about 40 seconds"
          blurb={
            <>
              Nine points you did not calibrate on, and a scatter of every sample taken at each one.
              This is how you tell a usable calibration from a hopeful one.
            </>
          }
          result={
            validation ? (
              <>
                {validation.errorPercent === null
                  ? "—"
                  : `${validation.errorPercent.toFixed(1)}% of the screen`}
                <span className={styles.cardAside}>
                  {validation.errorPx === null ? null : `${validation.errorPx.toFixed(0)} px off`}
                  {validation.precisionPx === null
                    ? null
                    : ` · ${validation.precisionPx.toFixed(0)} px scatter`}
                </span>
              </>
            ) : null
          }
          cta={validation ? "Check again" : "Check the accuracy"}
          disabled={!calibrated}
          onRun={() => onRun("validate")}
        />

        <Card
          title="Image scanpath"
          cost="about 20 seconds"
          blurb={
            <>
              Fifteen seconds of a painting, recorded through the extension exactly as a study would
              record it, and then your own fixations and saccades drawn back over it.
            </>
          }
          result={
            scanpath ? (
              <>
                {scanpath.fixations} fixations
                <span className={styles.cardAside}>
                  {scanpath.samples} samples
                  {scanpath.hz === null ? null : ` · ${scanpath.hz.toFixed(1)} Hz`}
                  {scanpath.medianFixationMs === null
                    ? null
                    : ` · ${scanpath.medianFixationMs.toFixed(0)} ms median`}
                </span>
              </>
            ) : null
          }
          cta={scanpath ? "Record another" : "Record a scanpath"}
          disabled={!calibrated}
          onRun={() => onRun("scanpath")}
        />

        <Card
          title="Free viewing"
          cost="as long as you like"
          blurb={
            <>
              The estimate live on the page, with the frame rate, the sampling rate and the
              smoothing window on show — and a slider that lets you trade one against the other.
            </>
          }
          result={
            <>
              Smoothing {session.smoothingFrames}{" "}
              {session.smoothingFrames === 1 ? "frame" : "frames"}
              <span className={styles.cardAside}>nothing is recorded</span>
            </>
          }
          cta="Look around"
          disabled={!calibrated}
          onRun={() => onRun("explore")}
        />
      </div>

      {!calibrated ? (
        <p className={styles.hint}>
          Calibration comes first: until the model has been fitted to your eyes there is no estimate
          for the other three to show.
        </p>
      ) : null}

      {session.rows.length > 0 ? <SessionData session={session} onReset={onReset} /> : null}
    </div>
  );
}

function SessionData({ session, onReset }: { session: Session; onReset: () => void }) {
  const highError = session.validation?.errorPercent;

  return (
    <div className={styles.panel}>
      {highError !== null && highError !== undefined && highError >= 12 ? (
        <p className={styles.note}>
          At {highError.toFixed(1)}% error only large, well-separated regions are distinguishable.
          More light on your face and a still head usually bring it down — calibrate again and see.
        </p>
      ) : null}

      <details className={styles.details}>
        <summary className={styles.detailsSummary}>Details for developers</summary>
        <dl className={styles.detailsBody}>
          <div>
            <dt className={styles.detailsKey}>Backend</dt>
            <dd className={styles.detailsValue}>{session.backend ?? "—"}</dd>
          </div>
          <div>
            <dt className={styles.detailsKey}>Frame rate</dt>
            <dd className={styles.detailsValue}>
              {session.fps === null ? "—" : `${session.fps.toFixed(0)} fps`}
            </dd>
          </div>
          <div>
            <dt className={styles.detailsKey}>Frame clock</dt>
            <dd className={styles.detailsValue}>{session.clock ?? "—"}</dd>
          </div>
          <div>
            <dt className={styles.detailsKey}>smoothing_frames</dt>
            <dd className={styles.detailsValue}>{session.smoothingFrames}</dd>
          </div>
        </dl>
        <p className={styles.detailsNote}>
          Every trial you have run this session, in order, exactly as{" "}
          <code>jsPsych.data.get().json()</code> returns it. Free viewing is not in here: it is not
          a trial, and it records nothing.
        </p>
        <pre className={styles.json}>{JSON.stringify(session.rows, null, 2)}</pre>
      </details>

      <div className={styles.buttonRow}>
        <button className={styles.abandon} onClick={onReset}>
          Close the camera and start over
        </button>
      </div>
    </div>
  );
}

export default function LiveDemo(): React.ReactNode {
  // The stylesheet link is outside `BrowserOnly` so it is in the prerendered HTML of this page
  // and downloads alongside it, rather than being appended after hydration.
  const jspsychCssUrl = useBaseUrl("/css/jspsych.css");
  return (
    <>
      {/*
        jsPsych's own stylesheet, linked rather than imported. Every selector in it is scoped
        under a `.jspsych-*` class, so it does not fight the theme — but it carries Open Sans as
        base64 `@font-face` data, and Docusaurus emits a single stylesheet for the whole site,
        so importing it would put ~460 kB of fonts on every page of the docs.
        `scripts/copy-jspsych-css.mjs` copies it out of `node_modules` into `static/css/`, and
        this link keeps the cost on the one page that needs it.
      */}
      <Head>
        <link rel="stylesheet" href={jspsychCssUrl} />
      </Head>
      <BrowserOnly fallback={<p>Loading the demo…</p>}>{() => <Demo />}</BrowserOnly>
    </>
  );
}
