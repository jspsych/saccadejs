import React, { useCallback, useEffect, useRef, useState } from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";
import Head from "@docusaurus/Head";
import useBaseUrl from "@docusaurus/useBaseUrl";
import clsx from "clsx";
import type { JsPsych } from "jspsych";
import type SaccadeExtension from "@saccadejs/extension";
import { detectFixations, drawScanpath, type Fixation, type Rect, type Sample } from "./scanpath";
import styles from "./styles.module.css";

/**
 * The live demo on `/demo`.
 *
 * It is a **real jsPsych experiment**: the published extension and the published plugins, on a
 * timeline that would work unchanged in a study, rendered into a container on this page with
 * `initJsPsych({ display_element })`. Nothing about the eye tracking is reimplemented here —
 * whatever an experimenter installs is exactly what runs, so the demo cannot quietly drift away
 * from the documentation.
 *
 * The experiment sets the camera up, calibrates, checks the calibration, and then shows a
 * painting for fifteen seconds while it records gaze. It ends by giving the participant their
 * own data twice over: the recorded trial as a scanpath drawn on the picture, and then the same
 * picture again with the gaze dot live on top of it.
 *
 * It runs everything a study would except `saccade-time-sync`, which measures this computer's
 * screen-to-camera lag so gaze can be lined up with stimulus timing. Nothing in a demo that ends
 * at "where were you looking" depends on it, and it costs a visitor a minute on a trial whose
 * result they never see. Experiments that care about *when* someone looked still need it — see
 * `Timing and synchrony`.
 *
 * React owns only what is outside the experiment: the screen before it starts and the numbers
 * after it finishes. Everything in between is jsPsych's.
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
  `<p>Nine more dots, the same as before: look straight at each one as it appears, and keep your
  head still.</p>`,
);

const SCENE_INSTRUCTIONS = instructions(
  "Free viewing",
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
    <p>Each circle is a fixation — somewhere your gaze stayed put — and the bigger ones are the
    ones you held longer. The lines between them are your saccades.</p>
    <p class="demo-legend"><span>start of the trial</span><i></i><span>end</span></p>
    <p class="demo-prompt">Press any key to continue.</p>
  </div>`;
}

function liveStimulus(src: string): string {
  return `<div class="demo-figure">
    <img id="live-scene" class="demo-scene" src="${src}" alt="" />
  </div>
  <div class="demo-caption">
    <p>The dot is where the tracker thinks you are looking, redrawn on every camera frame.</p>
    <p class="demo-prompt">Press any key to finish.</p>
  </div>`;
}

// ---------------------------------------------------------------------------------------
// the scanpath figure

/**
 * How far apart samples may sit and still count as one fixation, in pixels.
 *
 * Scaled to the error the validation trial just measured on this participant, rather than fixed:
 * a threshold tight enough to be meaningful on a good calibration shatters a noisy one into
 * dozens of one-sample fixations. `median_error_px` is a radius and the dispersion measure sums
 * two axes, hence the factor. The clamp keeps a wild validation result from producing either a
 * single fixation covering the whole picture or none at all.
 */
function dispersionFor(errorPx: number | null, rect: Rect): number {
  const unit = Math.min(rect.width, rect.height);
  const scaled = errorPx === null ? 0.18 * unit : 2.2 * errorPx;
  return Math.max(0.08 * unit, Math.min(0.34 * unit, scaled));
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
  errorPx: number | null,
): { fixations: Fixation[]; teardown: () => void } {
  const img = display.querySelector<HTMLImageElement>("#scanpath-scene");
  const canvas = display.querySelector<HTMLCanvasElement>("#scanpath-canvas");
  const samples = scene.saccade_data ?? [];
  const from = scene.saccade_targets?.["#scene"];

  if (!img || !canvas || !from) return { fixations: [], teardown: () => {} };

  const fixations = detectFixations(samples, {
    dispersion: dispersionFor(errorPx, from),
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
// summarising the data

interface Summary {
  errorPercent: number | null;
  errorPx: number | null;
  samples: number;
  seconds: number;
  hz: number | null;
  fixations: number;
  medianFixationMs: number | null;
  backend: string | null;
  fps: number | null;
  clock: string | null;
  json: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The numbers a participant can read off their own run. */
function summarise(jsPsych: JsPsych, fixations: Fixation[]): Summary {
  const data = jsPsych.data.get();
  const first = (trial_type: string): any => data.filter({ trial_type }).values()[0] ?? {};

  const preview = first("saccade-preview");
  const validation = first("saccade-validate");
  // By `demo_step` rather than by `trial_type`, so it keeps finding the free-viewing trial if
  // that is ever rebuilt on a different plugin.
  const scene = data.filter({ demo_step: "scene" }).values()[0] ?? ({} as any);

  const samples: Sample[] = scene.saccade_data ?? [];
  const seconds = SCENE_MS / 1000;

  return {
    errorPercent: Number.isFinite(validation.median_error_viewport)
      ? validation.median_error_viewport * 100
      : null,
    errorPx: Number.isFinite(validation.median_error_px) ? validation.median_error_px : null,
    samples: samples.length,
    seconds,
    hz: samples.length ? samples.length / seconds : null,
    fixations: fixations.length,
    medianFixationMs: median(fixations.map((f) => f.duration)),
    backend: preview.backend ?? null,
    fps: Number.isFinite(preview.fps) ? preview.fps : null,
    clock: scene.saccade_timing?.clock ?? null,
    json: data.json(),
  };
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

type Phase = "intro" | "running" | "done" | "error";

function Demo() {
  const modelUrl = useBaseUrl("/models/eye_embedding.onnx");
  const sceneUrl = useBaseUrl("/img/repin-unexpected-visitors.jpg");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const jsPsychRef = useRef<JsPsych | null>(null);
  /** Undoes whatever the scanpath trial attached to `window`; replaced on every run. */
  const scanpathTeardownRef = useRef<() => void>(() => {});
  /** Guards every `setState` after an await: the visitor may have navigated away mid-run. */
  const mountedRef = useRef(true);

  const [supported] = useState(
    () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia,
  );
  const [phase, setPhase] = useState<Phase>("intro");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * End the experiment and give the camera back.
   *
   * jsPsych has no teardown hook of its own, and the extension holds a `SaccadeTracker` with an
   * open `MediaStream`, so both have to be ended by hand: `abortExperiment` unwinds the
   * timeline (a no-op once it has finished) and the extension's `dispose()` stops the tracker,
   * releases the camera and removes the gaze dot and the camera preview from the page.
   */
  const teardown = useCallback(() => {
    scanpathTeardownRef.current();
    scanpathTeardownRef.current = () => {};
    const jsPsych = jsPsychRef.current;
    jsPsychRef.current = null;
    if (jsPsych) {
      const extension = jsPsych.extensions?.saccade as unknown as SaccadeExtension | undefined;
      try {
        jsPsych.abortExperiment();
      } catch {
        // Already finished, or never started: nothing to unwind.
      }
      try {
        extension?.dispose?.();
      } catch {
        // Nothing here is worth failing an unmount over.
      }
    }
    if (containerRef.current) containerRef.current.innerHTML = "";
  }, []);

  // Set on the way in as well as the way out, so a StrictMode double-mount does not leave the
  // component permanently marked as gone.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  const run = useCallback(async () => {
    teardown();
    setError(null);
    setSummary(null);
    setPhase("running");

    // Start the painting downloading now. Calibration and validation take two minutes, so it is
    // in the cache long before the trial that needs it, and nothing has to wait on this.
    new Image().src = sceneUrl;

    try {
      // Everything below reaches for the camera, WebGPU or the DOM at import time, so none of
      // it may be pulled in at module scope — this page is prerendered in Node.
      const [
        { initJsPsych },
        { default: jsPsychExtensionSaccade },
        { default: jsPsychSaccadePreview },
        { default: jsPsychSaccadeCalibrate },
        { default: jsPsychSaccadeValidate },
        { default: jsPsychHtmlButtonResponse },
        { default: jsPsychHtmlKeyboardResponse },
      ] = await Promise.all([
        import("jspsych"),
        import("@saccadejs/extension"),
        import("@saccadejs/plugin-preview"),
        import("@saccadejs/plugin-calibrate"),
        import("@saccadejs/plugin-validate"),
        import("@jspsych/plugin-html-button-response"),
        import("@jspsych/plugin-html-keyboard-response"),
      ]);

      const display = containerRef.current;
      if (!mountedRef.current || !display) return;

      const jsPsych = initJsPsych({
        display_element: display,
        extensions: [
          // The model is served from this site rather than the CDN; everything else (the
          // MediaPipe wasm, onnxruntime-web) comes from the defaults, as it would in an
          // experiment that has not been through `Hosting the assets`.
          { type: jsPsychExtensionSaccade, params: { assets: { modelUrl } } },
        ],
        // The experiment sits in the middle of a documentation page. Every trial begins by
        // putting it where the participant can see all of it — gaze is recorded in viewport
        // coordinates, so a stage half off the bottom of the window would be recorded honestly
        // and read as nonsense.
        on_trial_start: () => display.scrollIntoView({ block: "center" }),
      });
      jsPsychRef.current = jsPsych;
      const extension = jsPsych.extensions.saccade as unknown as SaccadeExtension;

      // Set by the scanpath trial, and read by the results panel afterwards: the figure and the
      // fixation count in the summary have to be the same fixations.
      let fixations: Fixation[] = [];

      const timeline = [
        // Camera permission, the model download with its progress bar, and head positioning.
        { type: jsPsychSaccadePreview },
        // Fit the gaze model on 13 points, then check it on 9 held-out points. Each is preceded
        // by an instruction screen, because each starts moving a dot as soon as it begins.
        {
          type: jsPsychHtmlButtonResponse,
          stimulus: CALIBRATE_INSTRUCTIONS,
          choices: ["Begin calibration"],
        },
        { type: jsPsychSaccadeCalibrate },
        {
          type: jsPsychHtmlButtonResponse,
          stimulus: VALIDATE_INSTRUCTIONS,
          choices: ["Begin accuracy check"],
        },
        { type: jsPsychSaccadeValidate },
        // Free viewing. An ordinary jsPsych trial; `extensions` is what turns recording on, and
        // `targets` records where the picture was, which is what the scanpath is drawn against.
        {
          type: jsPsychHtmlButtonResponse,
          stimulus: SCENE_INSTRUCTIONS,
          choices: ["Begin"],
        },
        {
          type: jsPsychHtmlKeyboardResponse,
          stimulus: sceneStimulus(sceneUrl),
          choices: "NO_KEYS",
          trial_duration: SCENE_MS,
          data: { demo_step: "scene" },
          extensions: [{ type: jsPsychExtensionSaccade, params: { targets: ["#scene"] } }],
        },
        // The recorded trial, given back as a picture.
        {
          type: jsPsychHtmlKeyboardResponse,
          stimulus: scanpathStimulus(sceneUrl),
          data: { demo_step: "scanpath" },
          on_load: () => {
            const scene = jsPsych.data.get().filter({ demo_step: "scene" }).values()[0] ?? {};
            const validation =
              jsPsych.data.get().filter({ trial_type: "saccade-validate" }).values()[0] ?? {};
            scanpathTeardownRef.current();
            const mounted = mountScanpath(
              display,
              scene,
              Number.isFinite(validation.median_error_px) ? validation.median_error_px : null,
            );
            fixations = mounted.fixations;
            scanpathTeardownRef.current = mounted.teardown;
          },
          on_finish: () => {
            scanpathTeardownRef.current();
            scanpathTeardownRef.current = () => {};
          },
        },
        // And the same picture live, which is the thing a recording can never show.
        {
          type: jsPsychHtmlKeyboardResponse,
          stimulus: liveStimulus(sceneUrl),
          data: { demo_step: "live" },
          on_load: () => extension.showPredictions(),
          on_finish: () => extension.hidePredictions(),
          extensions: [{ type: jsPsychExtensionSaccade, params: { targets: ["#live-scene"] } }],
        },
      ];

      await jsPsych.run(timeline);
      if (!mountedRef.current || jsPsychRef.current !== jsPsych) return;

      setSummary(summarise(jsPsych, fixations));
      setPhase("done");
      // The experiment is over: give the camera back, but leave the data in `jsPsych`.
      extension.dispose?.();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(explain(err));
      setPhase("error");
      teardown();
    }
  }, [modelUrl, sceneUrl, teardown]);

  /** Abandon a run that cannot continue, and go back to the start. */
  const abandon = useCallback(() => {
    teardown();
    setSummary(null);
    setError(null);
    setPhase("intro");
  }, [teardown]);

  return (
    <div className={styles.demo}>
      {phase === "intro" ? (
        <div className={clsx(styles.panel, styles.panelCentered)}>
          <p className={styles.lead}>
            Your webcam watches your eyes while you look at a handful of dots, and from that the
            page learns to guess where on the screen you are looking. Then it shows you a
            painting, and afterwards, where you looked at it. About four minutes.
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
            <button className={styles.primary} onClick={run}>
              Start
            </button>
          ) : (
            <p className={styles.status}>
              This browser cannot open a camera on this page. Cameras need a secure connection —
              open the page over <code>https://</code> or on <code>localhost</code>.
            </p>
          )}
        </div>
      ) : null}

      {phase === "error" && error ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorText}>{error}</p>
          <div className={styles.buttonRow}>
            <button className={styles.primary} onClick={run}>
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {/*
        jsPsych renders into this element for the whole run. It stays mounted in every phase so
        that nothing React does can pull the experiment (or the tracker's <video>, which Chrome
        only delivers frames to while it is rendered) out from under the trial that is running.
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
            Stop and start over
          </button>
        </p>
      ) : null}

      {phase === "done" && summary ? <Results summary={summary} onRerun={run} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// the results screen

function Measure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.measure}>
      <dt className={styles.measureKey}>{label}</dt>
      <dd className={styles.measureValue}>{children}</dd>
    </div>
  );
}

function Results({ summary, onRerun }: { summary: Summary; onRerun: () => void }) {
  return (
    <div className={styles.panel}>
      <h3 className={styles.resultsHeading}>Your data</h3>
      <dl className={styles.measures}>
        <Measure label="Accuracy, 9 held-out points">
          {summary.errorPercent === null
            ? "—"
            : `${summary.errorPercent.toFixed(1)}% of the screen`}
          {summary.errorPx === null ? null : (
            <span className={styles.measureAside}>{summary.errorPx.toFixed(0)} px</span>
          )}
        </Measure>
        <Measure label="Free viewing">
          {summary.samples} gaze samples
          <span className={styles.measureAside}>
            {summary.seconds.toFixed(0)} s
            {summary.hz === null ? null : ` · ${summary.hz.toFixed(1)} Hz`}
          </span>
        </Measure>
        <Measure label="Fixations">
          {summary.fixations}
          {summary.medianFixationMs === null ? null : (
            <span className={styles.measureAside}>
              {summary.medianFixationMs.toFixed(0)} ms median
            </span>
          )}
        </Measure>
      </dl>

      {summary.errorPercent !== null && summary.errorPercent >= 12 ? (
        <p className={styles.note}>
          At that error only large, well-separated regions are distinguishable. More light on your
          face and a still head usually bring it down.
        </p>
      ) : null}

      <details className={styles.details}>
        <summary className={styles.detailsSummary}>Details for developers</summary>
        <dl className={styles.detailsBody}>
          <div>
            <dt className={styles.detailsKey}>Backend</dt>
            <dd className={styles.detailsValue}>{summary.backend ?? "—"}</dd>
          </div>
          <div>
            <dt className={styles.detailsKey}>Frame rate</dt>
            <dd className={styles.detailsValue}>
              {summary.fps === null ? "—" : `${summary.fps.toFixed(0)} fps`}
            </dd>
          </div>
          <div>
            <dt className={styles.detailsKey}>Frame clock</dt>
            <dd className={styles.detailsValue}>{summary.clock ?? "—"}</dd>
          </div>
        </dl>
        <p className={styles.detailsNote}>
          Every trial's data, exactly as <code>jsPsych.data.get().json()</code> returns it.
        </p>
        <pre className={styles.json}>{summary.json}</pre>
      </details>

      <div className={styles.buttonRow}>
        <button className={styles.primary} onClick={onRerun}>
          Run again
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
