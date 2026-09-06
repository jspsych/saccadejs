import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BrowserOnly from "@docusaurus/BrowserOnly";
import useBaseUrl from "@docusaurus/useBaseUrl";
import clsx from "clsx";
import type {
  Gaze,
  LoopbackResult,
  SaccadeProgress,
  SaccadeProgressStage,
  SaccadeTracker,
  TrackerFrame,
  ValidationResult,
} from "@saccadejs/core";
import styles from "./styles.module.css";

/**
 * The live demo on `/demo`.
 *
 * It is deliberately shaped like a short experiment rather than a control panel: one screen at
 * a time, a thin banner at the top saying what is happening and why, and no diagnostics in the
 * participant's way (they live in one collapsed disclosure at the very end).
 *
 * Everything here touches `navigator.mediaDevices`, WebGPU/WebAssembly and a `<video>` element,
 * none of which exist while Docusaurus prerenders the page to static HTML — so the whole thing
 * is wrapped in `<BrowserOnly>` and `@saccadejs/core` is pulled in with a dynamic `import()`
 * from inside a callback, never at module scope.
 */

// ---------------------------------------------------------------------------------------
// constants

const SETTLE_MS = 1000;
const CAPTURE_MS = 500;
const ROI_RADIUS_PX = 200;
const LOOPBACK_MS = 15000;
/** How much free-viewing gaze to keep for the (developer-only) download button. */
const BUFFER_MS = 10000;
/** The model's eye crop, in pixels: 144 wide by 36 tall, grayscale. */
const CROP_W = 144;
const CROP_H = 36;

/** One screen of the flow. `phase` distinguishes "explain it" from "run it" from "show it". */
type Step = "intro" | "setup" | "check" | "timesync" | "calibrate" | "validate" | "free";
type Phase = "prompt" | "running" | "done";

const ANNOTATION: Record<Step, { title: string; count: string | null; text: string }> = {
  intro: {
    title: "Before you start",
    count: null,
    text: "This page runs a real eye tracker in your browser. Nothing is uploaded — every camera frame is used and then thrown away on your own computer.",
  },
  setup: {
    title: "Setting up",
    count: "Step 1 of 6",
    text: "Your browser is asking for the camera and downloading the eye-tracking model, about 20 MB. This happens once; after that it is cached.",
  },
  check: {
    title: "Camera check",
    count: "Step 2 of 6",
    text: "Sit about an arm's length away with light on your face. The small strip is the picture of your eyes the model actually sees.",
  },
  timesync: {
    title: "Timing check",
    count: "Step 3 of 6",
    text: "Screens and cameras both add a small delay. Measuring it lets a gaze sample be lined up with whatever was on screen at the time.",
  },
  calibrate: {
    title: "Calibration",
    count: "Step 4 of 6",
    text: "The tracker learns what your eyes look like when you look at known places on the screen.",
  },
  validate: {
    title: "Accuracy check",
    count: "Step 5 of 6",
    text: "Nine new dots that the calibration never saw, so the number at the end is an honest measure of how far off the tracker is.",
  },
  free: {
    title: "Free look",
    count: "Step 6 of 6",
    text: "The red dot is where the tracker thinks you are looking. Look around the page and move your eyes, not your head.",
  },
};

/**
 * The load stages `SaccadeTracker.init()` reports, in the order it walks them, with the rough
 * share of the wait each one takes. Only the model download reports bytes, and it is most of
 * the wait, so it gets most of the bar.
 */
const SETUP_STAGES: { stage: SaccadeProgressStage; label: string; weight: number }[] = [
  { stage: "camera", label: "Waiting for camera permission", weight: 1 },
  { stage: "mediapipe", label: "Loading the face tracker", weight: 2 },
  { stage: "landmarker", label: "Loading the face model", weight: 3 },
  { stage: "ort", label: "Starting the model runtime", weight: 2 },
  { stage: "model", label: "Downloading eye model", weight: 10 },
  { stage: "session", label: "Warming up the model", weight: 2 },
];
const SETUP_TOTAL_WEIGHT = SETUP_STAGES.reduce((a, s) => a + s.weight, 0);

interface Stats {
  fps: number;
  faceFound: boolean;
  clock: string;
}

interface Sample {
  x: number;
  y: number;
  t: number;
}

const mb = (n: number): string => (n / 1e6).toFixed(1);

/** Fraction of the whole setup that `p` represents, 0..1. */
function setupFraction(p: SaccadeProgress | null): number {
  if (!p) return 0;
  if (p.stage === "ready") return 1;
  let before = 0;
  for (const s of SETUP_STAGES) {
    if (s.stage === p.stage) {
      const inner = p.total && p.loaded != null ? Math.min(1, p.loaded / p.total) : 0;
      return (before + s.weight * inner) / SETUP_TOTAL_WEIGHT;
    }
    before += s.weight;
  }
  return before / SETUP_TOTAL_WEIGHT;
}

function setupLabel(p: SaccadeProgress | null): string {
  if (!p) return "Starting…";
  if (p.stage === "ready") return "Ready";
  const base = SETUP_STAGES.find((s) => s.stage === p.stage)?.label ?? "Loading";
  if (p.stage !== "model" || p.loaded == null) return `${base}…`;
  return p.total ? `${base} ${mb(p.loaded)} / ${mb(p.total)} MB` : `${base} ${mb(p.loaded)} MB`;
}

/** Turn whatever went wrong into one sentence a participant can act on. */
function explain(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/NotAllowed|Permission denied/i.test(message)) {
    return "The browser blocked access to the camera. Allow the camera for this site — the icon at the left of the address bar — and then try again. Nothing is uploaded; frames are processed and discarded on your computer.";
  }
  if (/NotFound|NotReadable|Device|Overconstrained/i.test(message)) {
    return "No usable camera was found. Connect a webcam, close any other program that might be using it, and try again.";
  }
  if (/eye_embedding|onnx|fetch|network|404|Failed to load/i.test(message)) {
    return "The eye-tracking model could not be downloaded. Check your internet connection and try again.";
  }
  if (/enough usable/i.test(message)) {
    return message;
  }
  return `Something went wrong: ${message}`;
}

// ---------------------------------------------------------------------------------------
// small presentational pieces

function Banner({ step }: { step: Step }) {
  const a = ANNOTATION[step];
  return (
    <div className={styles.banner}>
      <div className={styles.bannerHead}>
        <span className={styles.bannerTitle}>{a.title}</span>
        {a.count ? <span className={styles.bannerCount}>{a.count}</span> : null}
      </div>
      <p className={styles.bannerText}>{a.text}</p>
    </div>
  );
}

function ProgressBar({ fraction, label }: { fraction: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div className={styles.progressWrap}>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={styles.progressBar} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.progressLabel}>{label}</span>
    </div>
  );
}

/**
 * The full-viewport target overlay used by calibration and validation. Coordinates are
 * viewport fractions, which is exactly what the core hands to `showTarget`, so no conversion
 * is needed beyond turning them into percentages.
 */
function TargetOverlay({
  target,
  phase,
  caption,
}: {
  target: Gaze | null;
  phase: "settle" | "capture";
  caption: string;
}) {
  if (!target) return null;
  // Portalled to <body>: the targets are placed in viewport fractions, and a `position: fixed`
  // element is trapped by any ancestor with a transform or a filter — which the theme is free
  // to add to the article column at any point.
  return createPortal(
    <div className={styles.overlay} role="presentation">
      <p className={styles.overlayCaption}>{caption}</p>
      <div
        className={clsx(styles.targetPoint, phase === "capture" && styles.targetCapture)}
        style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%` }}
      >
        <span
          className={styles.targetRing}
          style={{ transitionDuration: phase === "settle" ? `${SETTLE_MS}ms` : "120ms" }}
        />
        <span className={styles.targetDot} />
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------------------
// the demo itself

function Demo() {
  const modelUrl = useBaseUrl("/models/eye_embedding.onnx");

  const trackerRef = useRef<SaccadeTracker | null>(null);
  const videoSlotRef = useRef<HTMLDivElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gazeDotRef = useRef<HTMLDivElement | null>(null);
  const bufferRef = useRef<Sample[]>([]);
  const statsRef = useRef<Stats>({ fps: 0, faceFound: false, clock: "—" });
  const showGazeRef = useRef(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  /** Guards every `setState` that follows an await: the visitor may have navigated away. */
  const mountedRef = useRef(true);

  const [supported] = useState(
    () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia,
  );
  const [step, setStep] = useState<Step>("intro");
  const [phase, setPhase] = useState<Phase>("prompt");
  const [error, setError] = useState<string | null>(null);
  const [setupProgress, setSetupProgress] = useState<SaccadeProgress | null>(null);
  const [runFraction, setRunFraction] = useState(0);
  const [stats, setStats] = useState<Stats>(statsRef.current);
  const [backend, setBackend] = useState<"webgpu" | "wasm" | null>(null);
  const [loopback, setLoopback] = useState<LoopbackResult | null>(null);
  const [calibration, setCalibration] = useState<{ nPoints: number; lambda: number } | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [target, setTarget] = useState<Gaze | null>(null);
  const [targetPhase, setTargetPhase] = useState<"settle" | "capture">("settle");

  // -- per-frame work, done imperatively so 30 fps never becomes 30 React renders/second --
  const handleFrame = useCallback((frame: TrackerFrame) => {
    statsRef.current = {
      fps: frame.fps,
      faceFound: frame.faceFound,
      clock: frame.time.source,
    };

    const canvas = cropCanvasRef.current;
    if (canvas && frame.crop) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const image = ctx.createImageData(CROP_W, CROP_H);
        for (let i = 0; i < CROP_W * CROP_H; i++) {
          const v = frame.crop[i];
          image.data[i * 4] = v;
          image.data[i * 4 + 1] = v;
          image.data[i * 4 + 2] = v;
          image.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
      }
    }

    if (frame.gaze && showGazeRef.current) {
      const px = frame.gaze.x * window.innerWidth;
      const py = frame.gaze.y * window.innerHeight;
      const dot = gazeDotRef.current;
      if (dot) {
        dot.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%)`;
        dot.style.opacity = "1";
      }
      const t = frame.time.meanCapture ?? frame.time.capture;
      const buffer = bufferRef.current;
      buffer.push({ x: Math.round(px), y: Math.round(py), t: Math.round(t * 100) / 100 });
      const cutoff = t - BUFFER_MS;
      while (buffer.length > 1 && buffer[0].t < cutoff) buffer.shift();
    }
  }, []);

  // Flush the frame stats into React at a human rate, and only on the two screens that read
  // them (the camera check needs "is there a face", the details panel needs the rest).
  useEffect(() => {
    if (step !== "check" && step !== "free") return;
    const id = window.setInterval(() => setStats({ ...statsRef.current }), 300);
    return () => window.clearInterval(id);
  }, [step]);

  // Hand the tracker's <video> to whichever slot is currently on screen.
  useEffect(() => {
    const slot = videoSlotRef.current;
    const tracker = trackerRef.current;
    if (!slot || !tracker) return;
    tracker.video.classList.add(styles.video);
    tracker.video.setAttribute("aria-label", "Live camera preview, mirrored");
    slot.appendChild(tracker.video);
    return () => {
      if (tracker.video.parentNode === slot) slot.removeChild(tracker.video);
    };
  }, [step]);

  // Stop the camera and the frame loop when the visitor navigates away mid-run. (Set on the
  // way in as well as the way out, so a StrictMode double-mount does not leave the component
  // permanently marked as gone.)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      showGazeRef.current = false;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      trackerRef.current?.dispose();
      trackerRef.current = null;
    };
  }, []);

  const fail = useCallback((err: unknown) => {
    if (!mountedRef.current) return;
    setError(explain(err));
    setPhase("prompt");
    setTarget(null);
  }, []);

  // -- 1. setup: camera permission + the model downloads ---------------------------------
  const beginSetup = useCallback(async () => {
    setError(null);
    setSetupProgress({ stage: "camera" });
    setStep("setup");
    setPhase("running");
    try {
      const { SaccadeTracker: Tracker } = await import("@saccadejs/core");
      const tracker =
        trackerRef.current ??
        new Tracker({
          assets: { modelUrl },
          tta: 5,
          onProgress: (p) => {
            if (mountedRef.current) setSetupProgress(p);
          },
        });
      trackerRef.current = tracker;
      const info = await tracker.init();
      if (!mountedRef.current) return;
      setBackend(info.ep);
      unsubscribeRef.current ??= tracker.onFrame(handleFrame);
      tracker.start();
      setStep("check");
      setPhase("prompt");
    } catch (err) {
      fail(err);
    }
  }, [fail, handleFrame, modelUrl]);

  // The target UI shared by calibration and validation. `setTarget`/`setTargetPhase` are
  // stable, so this is safe to build fresh inside each run.
  const targetUi = useCallback(
    () => ({
      showTarget: (t: Gaze | null, p: "settle" | "capture") => {
        setTarget(t);
        setTargetPhase(p);
      },
    }),
    [],
  );

  // -- 3. time sync ------------------------------------------------------------------------
  const runTimeSync = useCallback(async () => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    setError(null);
    setRunFraction(0);
    setPhase("running");
    try {
      const { runLoopback } = await import("@saccadejs/core");
      const result = await runLoopback(tracker, {
        durationMs: LOOPBACK_MS,
        onProgress: (f) => {
          if (mountedRef.current) setRunFraction(f);
        },
      });
      if (!mountedRef.current) return;
      setLoopback(result);
      setPhase("done");
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  // -- 4. calibration ----------------------------------------------------------------------
  const runCalibrate = useCallback(async () => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    setError(null);
    setPhase("running");
    try {
      const { runCalibration, defaultGrid13 } = await import("@saccadejs/core");
      tracker.clearCalibration();
      setCalibration(null);
      setValidation(null);
      await runCalibration(
        tracker,
        defaultGrid13(),
        { settleMs: SETTLE_MS, captureMs: CAPTURE_MS },
        targetUi(),
      );
      const fit = tracker.fitCalibration();
      if (!fit) {
        throw new Error(
          "Calibration did not collect enough usable samples. Make sure your face stays in the camera's view, then try again.",
        );
      }
      if (!mountedRef.current) return;
      setCalibration(fit);
      setTarget(null);
      setStep("validate");
      setPhase("prompt");
    } catch (err) {
      fail(err);
    }
  }, [fail, targetUi]);

  // -- 5. validation -----------------------------------------------------------------------
  const runValidate = useCallback(async () => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    setError(null);
    setPhase("running");
    try {
      const { runValidation, validationGrid9 } = await import("@saccadejs/core");
      const result = await runValidation(
        tracker,
        validationGrid9(),
        {
          settleMs: SETTLE_MS,
          captureMs: CAPTURE_MS * 4,
          roiRadiusPx: ROI_RADIUS_PX,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        },
        targetUi(),
      );
      if (!mountedRef.current) return;
      setValidation(result);
      setTarget(null);
      setPhase("done");
    } catch (err) {
      fail(err);
    }
  }, [fail, targetUi]);

  // -- 6. free look ------------------------------------------------------------------------
  const startFreeLook = useCallback(() => {
    bufferRef.current = [];
    showGazeRef.current = true;
    setStep("free");
    setPhase("done");
  }, []);

  const hideGaze = useCallback(() => {
    showGazeRef.current = false;
    if (gazeDotRef.current) gazeDotRef.current.style.opacity = "0";
  }, []);

  const recalibrate = useCallback(() => {
    hideGaze();
    setValidation(null);
    setStep("calibrate");
    setPhase("prompt");
  }, [hideGaze]);

  const restart = useCallback(() => {
    hideGaze();
    trackerRef.current?.clearCalibration();
    setLoopback(null);
    setCalibration(null);
    setValidation(null);
    setError(null);
    setStep("check");
    setPhase("prompt");
  }, [hideGaze]);

  const retry = useCallback(() => {
    setError(null);
    if (step === "setup") void beginSetup();
    else if (step === "timesync") void runTimeSync();
    else if (step === "calibrate") void runCalibrate();
    else if (step === "validate") void runValidate();
    else setPhase("prompt");
  }, [beginSetup, runCalibrate, runTimeSync, runValidate, step]);

  const downloadSamples = useCallback(() => {
    const payload = {
      generated: new Date().toISOString(),
      note: "x and y are pixels in this browser window; t is performance.now() at the camera's capture time, averaged over the test-time-augmentation window.",
      backend,
      timing: loopback
        ? { lag_ms: loopback.lagMs, verdict: loopback.verdict, clock: loopback.clockSource }
        : null,
      validation: validation ? { median_error_viewport: validation.medianErrorViewport } : null,
      samples: bufferRef.current,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "saccadejs-demo-gaze.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [backend, loopback, validation]);

  // -- render -------------------------------------------------------------------------------

  function body(): React.ReactNode {
    if (error) {
      return (
        <div className={styles.error} role="alert">
          <p className={styles.errorText}>{error}</p>
          <div className={styles.buttonRow}>
            <button className={styles.primary} onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      );
    }

    switch (step) {
      case "intro":
        return (
          <div className={clsx(styles.panel, styles.panelCentered)}>
            <p className={styles.lead}>
              Over the next minute your camera will watch your eyes while you look at a handful of
              dots. From that, the page learns to guess where on the screen you are looking, and
              then shows you a dot that follows your gaze. It all happens in this tab.
            </p>
            <ul className={styles.requirements}>
              <li>Chrome or Edge on a laptop or desktop</li>
              <li>A webcam, and permission to use it when the browser asks</li>
              <li>Sit about an arm's length from the screen</li>
              <li>Light on your face, not behind you — avoid sitting with a window at your back</li>
              <li>Keep your head still once calibration starts; move your eyes, not your head</li>
            </ul>
            {supported ? (
              <button className={styles.primary} onClick={beginSetup}>
                Start
              </button>
            ) : (
              <p className={styles.status}>
                This browser cannot open a camera on this page. Cameras need a secure connection —
                open the page over <code>https://</code> or on <code>localhost</code>.
              </p>
            )}
          </div>
        );

      case "setup":
        return (
          <div className={clsx(styles.panel, styles.panelCentered)}>
            <ProgressBar
              fraction={setupFraction(setupProgress)}
              label={setupLabel(setupProgress)}
            />
            <p className={styles.status}>
              Please wait — you can carry on once everything has loaded.
            </p>
          </div>
        );

      case "check":
        return (
          <div className={clsx(styles.panel, styles.panelCentered)}>
            <div className={styles.previewRow}>
              <div className={styles.videoWrap} ref={videoSlotRef} />
              <div className={styles.cropWrap}>
                <canvas
                  ref={cropCanvasRef}
                  width={CROP_W}
                  height={CROP_H}
                  className={styles.crop}
                  aria-label="The picture of your eyes that is fed to the model"
                />
                <span className={styles.caption}>what the model sees</span>
              </div>
            </div>
            <p
              className={clsx(
                styles.faceState,
                stats.faceFound ? styles.faceFound : styles.faceMissing,
              )}
            >
              {stats.faceFound
                ? "Your face is being tracked."
                : "Looking for your face — move into the middle of the picture."}
            </p>
            <button
              className={styles.primary}
              onClick={() => {
                setPhase("prompt");
                setStep("timesync");
              }}
              disabled={!stats.faceFound}
            >
              Continue
            </button>
          </div>
        );

      case "timesync":
        if (phase === "done" && loopback) {
          const usable = Number.isFinite(loopback.lagMs) && loopback.verdict !== "INCONCLUSIVE";
          return (
            <div className={clsx(styles.panel, styles.panelCentered)}>
              <p className={styles.result}>
                {usable
                  ? `Display and camera lag: ${loopback.lagMs.toFixed(0)} ms`
                  : "The lag could not be measured on this computer."}
              </p>
              <p className={styles.resultNote}>
                {usable
                  ? "That is how long it takes for something on screen to reach the camera. It does not affect the demo — it is what an experiment would subtract to line gaze up with its stimuli."
                  : "That is fine for the demo; it only matters for experiments that need gaze lined up with stimulus timing."}
              </p>
              <div className={styles.buttonRow}>
                <button
                  className={styles.primary}
                  onClick={() => {
                    setPhase("prompt");
                    setStep("calibrate");
                  }}
                >
                  Continue
                </button>
                <button className={styles.secondary} onClick={runTimeSync}>
                  Measure again
                </button>
              </div>
            </div>
          );
        }
        if (phase === "running") {
          return (
            <div className={clsx(styles.panel, styles.panelCentered)}>
              <ProgressBar fraction={runFraction} label="Measuring…" />
              <p className={styles.status}>
                The screen is changing brightness while the camera watches. This takes 15 seconds.
              </p>
            </div>
          );
        }
        return (
          <div className={clsx(styles.panel, styles.panelCentered)}>
            <p className={styles.lead}>
              The screen will slowly change between black and white for fifteen seconds while the
              camera watches it. Just sit still and look at the screen; press <kbd>Esc</kbd> if you
              want to stop early.
            </p>
            <button className={styles.primary} onClick={runTimeSync}>
              Start the timing check
            </button>
          </div>
        );

      case "calibrate":
        if (phase === "running") {
          return (
            <div className={clsx(styles.panel, styles.panelCentered)}>
              <p className={styles.status}>Calibrating…</p>
            </div>
          );
        }
        return (
          <div className={clsx(styles.panel, styles.panelCentered)}>
            <p className={styles.lead}>
              Thirteen dots will appear one at a time. Look straight at each one and hold still — it
              turns green while your eyes are being measured. This takes about twenty seconds.
            </p>
            <button className={styles.primary} onClick={runCalibrate}>
              Start calibration
            </button>
          </div>
        );

      case "validate":
        if (phase === "done" && validation) {
          const pct = validation.medianErrorViewport * 100;
          const good = Number.isFinite(pct) && pct < 10;
          return (
            <div className={clsx(styles.panel, styles.panelCentered)}>
              <p className={styles.result}>
                {Number.isFinite(pct)
                  ? `Median error: ${pct.toFixed(1)}% of the screen`
                  : "No usable gaze was collected."}
              </p>
              <p className={styles.resultNote}>
                {good
                  ? "That is a normal result for a webcam — good enough to tell which quarter of the screen you are looking at, not which word."
                  : "That is on the high side. Recalibrating without moving your head, with more light on your face, usually helps."}
              </p>
              <div className={styles.buttonRow}>
                <button className={styles.primary} onClick={startFreeLook}>
                  Continue
                </button>
                <button className={styles.secondary} onClick={recalibrate}>
                  Recalibrate
                </button>
              </div>
            </div>
          );
        }
        if (phase === "running") {
          return (
            <div className={clsx(styles.panel, styles.panelCentered)}>
              <p className={styles.status}>Checking accuracy…</p>
            </div>
          );
        }
        return (
          <div className={clsx(styles.panel, styles.panelCentered)}>
            <p className={styles.lead}>
              Nine more dots, the same way: look at each one and hold still. This time the tracker
              is being graded rather than trained.
            </p>
            <button className={styles.primary} onClick={runValidate}>
              Start the accuracy check
            </button>
          </div>
        );

      case "free":
        return (
          <div className={clsx(styles.panel, styles.panelCentered)}>
            <p className={styles.lead}>
              You are done. Look around — the red dot follows your gaze. It drifts if you move your
              head, which is why real experiments recalibrate now and then.
            </p>
            <div className={styles.buttonRow}>
              <button className={styles.secondary} onClick={recalibrate}>
                Recalibrate
              </button>
              <button className={styles.secondary} onClick={restart}>
                Start over
              </button>
            </div>
          </div>
        );
    }
  }

  return (
    <div className={styles.demo}>
      <Banner step={step} />
      {body()}

      {step === "free" && !error ? (
        <details className={styles.details}>
          <summary className={styles.detailsSummary}>Details for developers</summary>
          <dl className={styles.detailsBody}>
            <div>
              <dt className={styles.detailsKey}>Backend</dt>
              <dd className={styles.detailsValue}>{backend ?? "—"}</dd>
            </div>
            <div>
              <dt className={styles.detailsKey}>Frame rate</dt>
              <dd className={styles.detailsValue}>{stats.fps.toFixed(0)} fps</dd>
            </div>
            <div>
              <dt className={styles.detailsKey}>Frame clock</dt>
              <dd className={styles.detailsValue}>{stats.clock}</dd>
            </div>
            <div>
              <dt className={styles.detailsKey}>Loopback lag</dt>
              <dd className={styles.detailsValue}>
                {loopback ? `${loopback.lagMs.toFixed(1)} ms (${loopback.verdict})` : "—"}
              </dd>
            </div>
            <div>
              <dt className={styles.detailsKey}>Calibration</dt>
              <dd className={styles.detailsValue}>
                {calibration ? `${calibration.nPoints} pts, λ=${calibration.lambda}` : "—"}
              </dd>
            </div>
            <div>
              <dt className={styles.detailsKey}>Validation</dt>
              <dd className={styles.detailsValue}>
                {validation
                  ? `${(validation.medianErrorViewport * 100).toFixed(1)}% · ${validation.meanErrorPx.toFixed(0)} px · ${validation.percentInRoi.toFixed(0)}% in ${ROI_RADIUS_PX} px`
                  : "—"}
              </dd>
            </div>
          </dl>
          <div className={styles.buttonRow} style={{ justifyContent: "flex-start" }}>
            <button className={styles.secondary} onClick={downloadSamples}>
              Download the last 10 s as JSON
            </button>
          </div>
        </details>
      ) : null}

      {createPortal(
        <div
          ref={gazeDotRef}
          className={styles.gazeDot}
          style={{ opacity: 0 }}
          aria-hidden="true"
        />,
        document.body,
      )}
      <TargetOverlay
        target={target}
        phase={targetPhase}
        caption="Look at the dot and hold still."
      />
    </div>
  );
}

export default function LiveDemo(): React.ReactNode {
  return <BrowserOnly fallback={<p>Loading the demo…</p>}>{() => <Demo />}</BrowserOnly>;
}
