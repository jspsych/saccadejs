import React, { useCallback, useEffect, useRef, useState } from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";
import Head from "@docusaurus/Head";
import useBaseUrl from "@docusaurus/useBaseUrl";
import clsx from "clsx";
import type { JsPsych } from "jspsych";
import type SaccadeExtension from "@saccadejs/extension";
import styles from "./styles.module.css";

/**
 * The live demo on `/demo`.
 *
 * It is a **real jsPsych experiment**: the published extension and the four published plugins,
 * on the timeline from `docs/getting-started.mdx`, rendered into a container on this page with
 * `initJsPsych({ display_element })`. Nothing about the eye tracking is reimplemented here —
 * whatever an experimenter installs is exactly what runs, so the demo cannot quietly drift away
 * from the documentation.
 *
 * React contributes three things and no more: the intro screen, the annotation banner above the
 * experiment (driven from jsPsych's `on_trial_start`), and the plain-language summary after
 * `jsPsych.run()` resolves.
 *
 * Everything the experiment touches — `navigator.mediaDevices`, WebGPU/WebAssembly, a `<video>`
 * element — is absent while Docusaurus prerenders this page to static HTML, so the component is
 * wrapped in `<BrowserOnly>` and every saccade.js/jsPsych module is pulled in with a dynamic
 * `import()` from inside a callback, never at module scope.
 */

// ---------------------------------------------------------------------------------------
// the annotation banner

interface Annotation {
  title: string;
  step: number | null;
  text: string;
}

const TOTAL_STEPS = 6;

/**
 * What to say above each trial, keyed by the plugin's `info.name` — the same string that lands
 * in the data as `trial_type`. `on_trial_start` looks the running trial up in here, so adding a
 * trial to the timeline means adding a line here and nothing else.
 */
const ANNOTATIONS: Record<string, Annotation> = {
  "saccade-preview": {
    title: "Camera setup",
    step: 1,
    text: "Your browser is asking for the camera and downloading the eye model, about 20 MB. Sit an arm's length away, with light on your face rather than behind you.",
  },
  "saccade-time-sync": {
    title: "Timing check",
    step: 2,
    text: "Screens and cameras both add a small delay. Measuring it is what lets a gaze sample be lined up with whatever was on the screen at the time.",
  },
  "saccade-calibrate": {
    title: "Calibration",
    step: 3,
    text: "Thirteen dots, one at a time. Look straight at each one and hold still — this is where the tracker learns what your eyes look like when you look at a known place.",
  },
  "saccade-validate": {
    title: "Accuracy check",
    step: 4,
    text: "Nine dots the calibration never saw, so the number at the end is an honest measure of how far off the tracker is.",
  },
  "html-keyboard-response": {
    title: "Free look",
    step: 5,
    text: "An ordinary jsPsych trial with the extension attached. The red dot is where the tracker thinks you are looking; every frame of it is being recorded.",
  },
};

const INTRO: Annotation = {
  title: "Before you start",
  step: null,
  text: "This page runs a real eye tracker in your browser. Nothing is uploaded — every camera frame is used and then thrown away on your own computer.",
};

const RESULTS: Annotation = {
  title: "Results",
  step: TOTAL_STEPS,
  text: "What the experiment measured, in the units an experiment would report.",
};

// ---------------------------------------------------------------------------------------
// the free-viewing trial

/**
 * Two coloured squares with ids the extension records the position of. Written as a plain HTML
 * string with inline styles because it is rendered by jsPsych inside its own display element,
 * where this component's CSS module class names do not reach.
 */
const LOOK_STIMULUS = `
  <div style="display:flex; gap:12vw; justify-content:center; align-items:center; margin-bottom:1.5rem;">
    <div id="left" style="width:26vw; max-width:280px; aspect-ratio:4/3; border-radius:12px;
      background:#2563eb;"></div>
    <div id="right" style="width:26vw; max-width:280px; aspect-ratio:4/3; border-radius:12px;
      background:#f97316;"></div>
  </div>
  <p style="max-width:36rem; margin:0 auto;">Look at whichever square you prefer, for as long as
  you like. The red dot follows your gaze. Press any key when you are done.</p>`;

// ---------------------------------------------------------------------------------------
// summarising the data

interface Summary {
  lagMs: number | null;
  lagVerdict: string | null;
  errorPercent: number | null;
  leftSamples: number;
  rightSamples: number;
  totalSamples: number;
  backend: string | null;
  fps: number | null;
  clock: string | null;
  json: string;
}

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function countInRect(samples: Array<{ x: number; y: number }>, rect: Rect | undefined): number {
  if (!rect) return 0;
  return samples.filter(
    (s) => s.x >= rect.left && s.x <= rect.right && s.y >= rect.top && s.y <= rect.bottom,
  ).length;
}

/** Pull the handful of numbers a participant can actually read out of the trial data. */
function summarise(jsPsych: JsPsych): Summary {
  const data = jsPsych.data.get();
  const first = (trial_type: string): any => data.filter({ trial_type }).values()[0] ?? {};

  const preview = first("saccade-preview");
  const sync = first("saccade-time-sync");
  const validation = first("saccade-validate");
  const look = first("html-keyboard-response");

  const samples: Array<{ x: number; y: number }> = look.saccade_data ?? [];
  const targets: Record<string, Rect> = look.saccade_targets ?? {};

  return {
    lagMs: Number.isFinite(sync.lag_ms) ? sync.lag_ms : null,
    lagVerdict: sync.verdict ?? null,
    errorPercent: Number.isFinite(validation.median_error_viewport)
      ? validation.median_error_viewport * 100
      : null,
    leftSamples: countInRect(samples, targets["#left"]),
    rightSamples: countInRect(samples, targets["#right"]),
    totalSamples: samples.length,
    backend: preview.backend ?? null,
    fps: Number.isFinite(preview.fps) ? preview.fps : null,
    clock: look.saccade_timing?.clock ?? null,
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

  const containerRef = useRef<HTMLDivElement | null>(null);
  const jsPsychRef = useRef<JsPsych | null>(null);
  /** Guards every `setState` after an await: the visitor may have navigated away mid-run. */
  const mountedRef = useRef(true);

  const [supported] = useState(
    () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia,
  );
  const [phase, setPhase] = useState<Phase>("intro");
  const [annotation, setAnnotation] = useState<Annotation>(INTRO);
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
    setAnnotation(ANNOTATIONS["saccade-preview"]);
    setPhase("running");

    try {
      // Everything below reaches for the camera, WebGPU or the DOM at import time, so none of
      // it may be pulled in at module scope — this page is prerendered in Node.
      const [
        { initJsPsych },
        { default: jsPsychExtensionSaccade },
        { default: jsPsychSaccadePreview },
        { default: jsPsychSaccadeTimeSync },
        { default: jsPsychSaccadeCalibrate },
        { default: jsPsychSaccadeValidate },
        { default: jsPsychHtmlKeyboardResponse },
      ] = await Promise.all([
        import("jspsych"),
        import("@saccadejs/extension"),
        import("@saccadejs/plugin-preview"),
        import("@saccadejs/plugin-time-sync"),
        import("@saccadejs/plugin-calibrate"),
        import("@saccadejs/plugin-validate"),
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
        on_trial_start: (trial: any) => {
          const name: string | undefined = trial?.type?.info?.name;
          if (name && ANNOTATIONS[name]) setAnnotation(ANNOTATIONS[name]);
        },
      });
      jsPsychRef.current = jsPsych;
      const extension = jsPsych.extensions.saccade as unknown as SaccadeExtension;

      const timeline = [
        // Camera permission, the model download with its progress bar, and head positioning.
        { type: jsPsychSaccadePreview },
        // Measure this participant's screen-to-camera lag and apply it to every later `t`.
        { type: jsPsychSaccadeTimeSync },
        // Fit the gaze model on 13 points, then check it on 9 held-out points.
        { type: jsPsychSaccadeCalibrate },
        { type: jsPsychSaccadeValidate },
        // An ordinary trial that records gaze. `extensions` is what turns recording on.
        {
          type: jsPsychHtmlKeyboardResponse,
          stimulus: LOOK_STIMULUS,
          on_load: () => extension.showPredictions(),
          on_finish: () => extension.hidePredictions(),
          extensions: [{ type: jsPsychExtensionSaccade, params: { targets: ["#left", "#right"] } }],
        },
      ];

      await jsPsych.run(timeline);
      if (!mountedRef.current || jsPsychRef.current !== jsPsych) return;

      setSummary(summarise(jsPsych));
      setAnnotation(RESULTS);
      setPhase("done");
      // The experiment is over: give the camera back, but leave the data in `jsPsych`.
      extension.dispose?.();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(explain(err));
      setPhase("error");
      teardown();
    }
  }, [modelUrl, teardown]);

  /** Abandon a run that cannot continue, and go back to the intro screen. */
  const abandon = useCallback(() => {
    teardown();
    setSummary(null);
    setError(null);
    setAnnotation(INTRO);
    setPhase("intro");
  }, [teardown]);

  return (
    <div className={styles.demo}>
      <div className={styles.banner}>
        <div className={styles.bannerHead}>
          <span className={styles.bannerTitle}>{annotation.title}</span>
          {annotation.step !== null ? (
            <span className={styles.bannerCount}>
              Step {annotation.step} of {TOTAL_STEPS}
            </span>
          ) : null}
        </div>
        <p className={styles.bannerText}>{annotation.text}</p>
      </div>

      {phase === "intro" ? (
        <div className={clsx(styles.panel, styles.panelCentered)}>
          <p className={styles.lead}>
            Over the next few minutes your camera will watch your eyes while you look at a handful
            of dots. From that, the page learns to guess where on the screen you are looking, and
            then shows you a dot that follows your gaze. It is an ordinary jsPsych experiment,
            running the same plugins you would install yourself, in this tab.
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

function Results({ summary, onRerun }: { summary: Summary; onRerun: () => void }) {
  const preferred =
    summary.leftSamples === summary.rightSamples
      ? null
      : summary.leftSamples > summary.rightSamples
        ? "blue"
        : "orange";

  return (
    <div className={styles.panel}>
      <h3 className={styles.resultsHeading}>What just happened</h3>
      <ul className={styles.resultsList}>
        <li>
          {summary.lagMs === null ? (
            <>
              The delay between your screen and your camera could not be measured on this computer.
              That only matters for experiments that line gaze up with stimulus timing.
            </>
          ) : (
            <>
              Your screen and camera together run{" "}
              <strong>{summary.lagMs.toFixed(0)} ms behind</strong>. Every gaze timestamp above has
              had that subtracted, so it is on the same clock as the trial's own timings.
              {summary.lagVerdict && summary.lagVerdict !== "OK"
                ? ` (The measurement came back ${summary.lagVerdict.toLowerCase()}.)`
                : null}
            </>
          )}
        </li>
        <li>
          {summary.errorPercent === null ? (
            <>No usable gaze was collected during the accuracy check.</>
          ) : (
            <>
              On the nine points it had never seen, the tracker was off by{" "}
              <strong>{summary.errorPercent.toFixed(1)}% of the screen</strong> on average.
              {summary.errorPercent < 10
                ? " That is a normal webcam result — good enough to tell which part of the screen you were looking at, not which word."
                : " That is on the high side. Recalibrating with more light on your face, and without moving your head, usually helps."}
            </>
          )}
        </li>
        <li>
          While the two squares were on screen, the tracker recorded{" "}
          <strong>{summary.totalSamples}</strong> gaze samples:{" "}
          <strong>{summary.leftSamples}</strong> landed on the blue square and{" "}
          <strong>{summary.rightSamples}</strong> on the orange one
          {preferred ? `, so you spent more of the trial looking at the ${preferred} one` : null}.
          The rest fell somewhere else on the page.
        </li>
      </ul>

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
