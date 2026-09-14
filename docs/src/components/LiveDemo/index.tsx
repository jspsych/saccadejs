import React, { useCallback, useEffect, useRef, useState } from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";
import Head from "@docusaurus/Head";
import useBaseUrl from "@docusaurus/useBaseUrl";
import clsx from "clsx";
import type { JsPsych } from "jspsych";
import type { SaccadeTracker } from "@saccadejs/core";
import type SaccadeExtension from "@saccadejs/extension";
import releases from "@saccadejs/core/models/releases.json";
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

/** How long the painting stays on screen per view. Two of these, so twice as long in total. */
const SCENE_MS = 10000;

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

const PREVIEW_INSTRUCTIONS = `<p>Center your face in the preview, and continue once the face
  indicator turns green.</p>`;

const CALIBRATE_INSTRUCTIONS = instructions(
  "Calibration",
  `<p>Thirteen dots will appear one at a time. Look at each one until it moves, keeping your head
  still and moving only your eyes.</p>`,
);

const VALIDATE_INSTRUCTIONS = instructions(
  "Accuracy check",
  `<p>Look at each of nine new dots, just as before. Afterwards you'll see where the tracker
  thought you were looking.</p>`,
);

/**
 * The two questions this demo puts to the viewer, and why these two.
 *
 * The picture is Repin's *They Did Not Expect Him* (1884–88), and it is here for one reason: it
 * is the stimulus from the best-known result in the field. Yarbus (*Eye Movements and Vision*,
 * 1967) recorded the same viewer examining it seven times under seven different questions, and
 * got seven visibly different scanpaths from one unchanging picture. Where someone looks is not
 * a property of the image.
 *
 * Two of his seven are enough to show that, and only if they pull in opposite directions: ages
 * drives gaze onto the faces and nothing else, while material circumstances sends it around the
 * room — the furniture, the walls, the floor. Put those two side by side and the result is
 * legible in a glance, which seven small figures would not be.
 *
 * The order is fixed rather than counterbalanced. A study comparing these conditions would have
 * to counterbalance them; a demo showing one person their own two scanpaths has nothing to
 * confound.
 */
interface ViewingTask {
  /** Short name for the results card. */
  label: string;
  /** The question, as the participant is given it before the picture appears. */
  prompt: string;
}

const VIEWING_TASKS: [ViewingTask, ViewingTask] = [
  {
    label: "Their ages",
    prompt: "Give the ages of the people.",
  },
  {
    label: "How well off they are",
    prompt: "Estimate how well off the family is.",
  },
];

/** The screen before each view. `index` is 0 for the first question, 1 for the second. */
function sceneInstructions(task: ViewingTask, index: number): string {
  return instructions(
    index === 0 ? "First view" : "Second view",
    `<p>${
      index === 0
        ? "A painting will appear for ten seconds. While you look at it:"
        : "Now the same painting again, with a new task:"
    }</p>
    <p class="demo-task"><strong>${task.prompt}</strong></p>`,
  );
}

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

/** One of the two figures on the comparison screen: the picture, the overlay, the question. */
function comparisonPanel(src: string, task: ViewingTask, index: number): string {
  return `<figure class="demo-compare-item">
    <div class="demo-figure demo-figure-stacked">
      <img id="scanpath-scene-${index}" class="demo-scene demo-scene-compare" src="${src}" alt="" />
      <canvas id="scanpath-canvas-${index}" class="demo-overlay"></canvas>
    </div>
    <figcaption class="demo-compare-caption">
      <span class="demo-compare-question">${task.prompt}</span>
      <span class="demo-note" id="scanpath-note-${index}"></span>
    </figcaption>
  </figure>`;
}

function comparisonStimulus(src: string): string {
  return `<div class="demo-compare">
    ${comparisonPanel(src, VIEWING_TASKS[0], 0)}
    ${comparisonPanel(src, VIEWING_TASKS[1], 1)}
  </div>
  <div class="demo-caption">
    <p class="demo-explain">Each circle is a place your gaze rested, larger the longer it stayed,
    and the lines are the jumps between them. The picture was the same both times; only the
    question changed.</p>
    <p class="demo-legend"><span>start of the view</span><i></i><span>end</span></p>
    <p class="demo-credit">Ilya Repin, <i>They Did Not Expect Him</i> (1884–88), the painting
    Yarbus used.</p>
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
  index: number,
): { fixations: Fixation[]; teardown: () => void } {
  const img = display.querySelector<HTMLImageElement>(`#scanpath-scene-${index}`);
  const canvas = display.querySelector<HTMLCanvasElement>(`#scanpath-canvas-${index}`);
  const samples = scene.saccade_data ?? [];
  const from = scene.saccade_targets?.["#scene"];

  // Without a rect for the picture there is no way to map the samples onto it, and without
  // samples there is nothing to map. Say so under that figure rather than leaving an unmarked
  // painting on screen looking like a scanpath with nothing in it — and say it under that one
  // only, because the other view may have recorded perfectly well.
  if (!img || !canvas || !from || !from.width || !from.height || samples.length === 0) {
    const note = display.querySelector(`#scanpath-note-${index}`);
    if (note) note.textContent = "No gaze was recorded for this view.";
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

/**
 * Whether there is a gaze model to use. `"failed"` is a calibration that ran to the end and
 * fitted nothing — no usable points, or the camera stalled part way — which has to stay locked
 * exactly like a calibration that never ran, but is worth saying out loud rather than leaving
 * the card reading "Not run yet" after twenty seconds of looking at dots.
 */
type CalibrationState = "none" | "ok" | "failed";

interface ValidationResult {
  errorPercent: number | null;
  errorPx: number | null;
  /** Median distance of a point's samples from their own mean: how scattered, not how wrong. */
  precisionPx: number | null;
}

/** One of the two views: the question it was recorded under, and what came out of it. */
interface ScanpathView {
  task: string;
  fixations: number;
  samples: number;
}

interface ScanpathResult {
  views: ScanpathView[];
  /** Samples per second over both views together — the rate a study would record at. */
  hz: number | null;
}

interface Session {
  calibration: CalibrationState;
  validation: ValidationResult | null;
  scanpath: ScanpathResult | null;
  /** Frames averaged per estimate: the tracker's own default until free viewing changes it. */
  smoothingFrames: number;
}

const EMPTY_SESSION: Session = {
  calibration: "none",
  validation: null,
  scanpath: null,
  smoothingFrames: 1,
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
  fixations: Fixation[][],
): Session {
  const data = jsPsych.data.get();
  const first = (trial_type: string): any => data.filter({ trial_type }).values()[0] ?? {};
  const next: Session = { ...prev };

  if (activity === "calibrate") {
    // `lambda` is the ridge penalty the fit used, and the plugin records it as `null` when
    // there was no fit — so it is also the answer to "is there a gaze model now?".
    const calibration = first("saccade-calibrate");
    next.calibration = Number.isFinite(calibration.lambda) ? "ok" : "failed";
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
    // By `demo_step` rather than by `trial_type`, so it keeps finding the viewing trials if
    // they are ever rebuilt on a different plugin. Two rows, in the order they were shown.
    const scenes = data.filter({ demo_step: "scene" }).values();
    const views = scenes.map((scene: any, i: number) => ({
      task: scene.viewing_task ?? VIEWING_TASKS[i]?.label ?? "",
      fixations: fixations[i]?.length ?? 0,
      samples: (scene.saccade_data ?? []).length,
    }));
    const samples = views.reduce((total, view) => total + view.samples, 0);
    next.scanpath = {
      views,
      hz: samples ? samples / ((scenes.length * SCENE_MS) / 1000) : null,
    };
  }

  return next;
}

// ---------------------------------------------------------------------------------------
// errors

/** Turn whatever went wrong into one sentence a participant can act on. */
function explain(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/NotAllowed|Permission denied/i.test(message)) {
    return "The browser blocked the camera. Allow it using the icon in the address bar, then try again.";
  }
  if (/NotFound|NotReadable|Device|Overconstrained/i.test(message)) {
    return "No camera was found. Connect a webcam or close other apps that are using it, then try again.";
  }
  if (/no camera frames/i.test(message)) {
    return "The camera stopped sending frames. Close other apps that are using it, then try again.";
  }
  if (/eye_embedding|onnx|fetch|network|404|Failed to load/i.test(message)) {
    return "The eye-tracking model couldn't be downloaded. Check your connection and try again.";
  }
  return `Something went wrong: ${message}`;
}

// ---------------------------------------------------------------------------------------
// the demo itself

type Phase = "menu" | "running" | "explore" | "error";

function Demo() {
  // The versioned path, which is the only one the site serves: using it here means that URL
  // is exercised on every deploy instead of being a link nobody walks.
  const current = releases.releases.filter((r) => r.served).at(-1)!;
  const modelUrl = useBaseUrl(`/models/${releases.id}/${current.version}/${current.file}`);
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
  const [phase, setPhase] = useState<Phase>("menu");
  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [error, setError] = useState<string | null>(null);

  const calibrated = session.calibration === "ok";

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
    setPhase("menu");
  }, [releaseCamera]);

  /** Abandon an activity that cannot continue, and go back to the menu. */
  const abandon = useCallback(() => {
    endActivity();
    setError(null);
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

        // Set by the comparison screen and read once the run is over, one list per view: the
        // figures the participant saw and the counts on the results card have to agree.
        let fixations: Fixation[][] = [];

        // Camera permission, the model download with its progress bar, and head positioning.
        // Only on the first activity of the session: after that the camera is already open, and
        // making somebody sit through a preview screen to recalibrate is friction for nothing.
        const setup = tracker.initialized
          ? []
          : [{ type: m.preview, instructions: PREVIEW_INSTRUCTIONS }];

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
            // One view per question: an instruction screen, then ten seconds of the picture.
            // The viewing trial is an ordinary jsPsych trial; `extensions` is what turns
            // recording on, and `targets` records where the picture was, which is what the
            // scanpath is drawn against.
            ...VIEWING_TASKS.flatMap((task, index) => [
              {
                type: m.button,
                stimulus: sceneInstructions(task, index),
                choices: [index === 0 ? "Begin" : "Begin the second view"],
              },
              {
                type: m.keyboard,
                stimulus: sceneStimulus(sceneUrl),
                choices: "NO_KEYS",
                trial_duration: SCENE_MS,
                // The question goes into the data, because it is the manipulation: the two
                // viewing trials differ in nothing else.
                data: { demo_step: "scene", viewing_task: task.label },
                extensions: [{ type: m.extension, params: { targets: ["#scene"] } }],
              },
            ]),
            // Both recordings, given back side by side. Drawn from the same fixations the
            // results card then counts.
            {
              type: m.button,
              stimulus: comparisonStimulus(sceneUrl),
              choices: ["Back to the menu"],
              data: { demo_step: "scanpath" },
              on_load: () => {
                const scenes = jsPsych.data.get().filter({ demo_step: "scene" }).values();
                scanpathTeardownRef.current();
                const mounted = scenes.map((scene: any, index: number) =>
                  mountScanpath(display, scene, session.validation?.precisionPx ?? null, index),
                );
                fixations = mounted.map((view) => view.fixations);
                scanpathTeardownRef.current = () => mounted.forEach((view) => view.teardown());
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
        setPhase("menu");
      } catch (err) {
        if (!mountedRef.current) return;
        setError(explain(err));
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
        <Menu
          session={session}
          calibrated={calibrated}
          supported={supported}
          onRun={run}
          onReset={reset}
        />
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
            Stop and go back
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

/**
 * What a visitor needs to know before they press anything, above the menu rather than on a
 * screen of its own: a click-through that only says "this is about to use your camera" is a
 * click-through, and the camera prompt itself says that better.
 */
function Preamble({ supported }: { supported: boolean }) {
  return (
    <div className={styles.preamble}>
      <p className={styles.lead}>
        Look at a few dots and this page learns where on the screen you're looking. Then you can
        check its accuracy, trace your gaze over a painting, or watch it live.{" "}
        <strong>Everything runs on your computer, and nothing is uploaded.</strong>
      </p>
      {!supported ? (
        <p className={styles.status}>
          The camera needs a secure connection, so open this page over <code>https://</code> or on{" "}
          <code>localhost</code>.
        </p>
      ) : null}
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
  supported,
  onRun,
  onReset,
}: {
  session: Session;
  calibrated: boolean;
  supported: boolean;
  onRun: (activity: Activity) => void;
  onReset: () => void;
}) {
  const { calibration, validation, scanpath } = session;

  return (
    <div className={styles.menu}>
      <Preamble supported={supported} />

      <div className={styles.cards}>
        <Card
          title="Calibration"
          cost="about a minute"
          blurb="Look at thirteen dots so the tracker can learn how your eyes move."
          result={
            calibration === "ok" ? (
              "Calibration complete"
            ) : calibration === "failed" ? (
              <span className={styles.cardPending}>
                That calibration didn't work. Try again with more light on your face.
              </span>
            ) : null
          }
          cta={calibration === "none" ? "Calibrate" : "Calibrate again"}
          disabled={!supported}
          onRun={() => onRun("calibrate")}
        />

        <Card
          title="Accuracy check"
          cost="about 40 seconds"
          blurb="Nine new dots measure how far off the tracker is."
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
          cta={!calibrated ? "Calibrate first" : validation ? "Check again" : "Check the accuracy"}
          disabled={!calibrated || !supported}
          onRun={() => onRun("validate")}
        />

        <Card
          title="Image scanpath"
          cost="about a minute"
          blurb="One painting, two questions, and where your eyes went for each."
          result={
            scanpath ? (
              <>
                Two scanpaths
                {scanpath.views.map((view) => (
                  <span className={styles.cardAside} key={view.task}>
                    {view.task}: {view.fixations} fixations
                  </span>
                ))}
              </>
            ) : null
          }
          cta={!calibrated ? "Calibrate first" : scanpath ? "Do it again" : "Record two scanpaths"}
          disabled={!calibrated || !supported}
          onRun={() => onRun("scanpath")}
        />

        <Card
          title="Free viewing"
          cost="as long as you like"
          blurb="Watch a dot follow your gaze around the page."
          result={<span className={styles.cardPending}>Nothing is recorded</span>}
          cta={!calibrated ? "Calibrate first" : "Look around"}
          disabled={!calibrated || !supported}
          onRun={() => onRun("explore")}
        />
      </div>

      {calibration !== "none" ? (
        <div className={styles.buttonRow}>
          <button className={styles.abandon} onClick={onReset}>
            Stop the camera and reset calibration
          </button>
        </div>
      ) : null}
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
