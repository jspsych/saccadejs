import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BrowserOnly from "@docusaurus/BrowserOnly";
import useBaseUrl from "@docusaurus/useBaseUrl";
import clsx from "clsx";
import type {
  CalPoint,
  Gaze,
  LoopbackResult,
  SaccadeTracker,
  TrackerFrame,
  ValidationResult,
} from "saccadejs";
import styles from "./styles.module.css";

/**
 * The live demo on `/demo`.
 *
 * Everything here touches `navigator.mediaDevices`, WebGPU/WebAssembly and a `<video>`
 * element, none of which exist while Docusaurus prerenders the page to static HTML — so the
 * whole thing is wrapped in `<BrowserOnly>` and `saccadejs` is pulled in with a dynamic
 * `import()` from inside an effect, never at module scope.
 */

// ---------------------------------------------------------------------------------------
// constants

const SETTLE_MS = 1000;
const CAPTURE_MS = 500;
const ROI_RADIUS_PX = 200;
const LOOPBACK_MS = 15000;
/** How much free-viewing gaze to keep for the download button. */
const BUFFER_MS = 10000;
/** The model's eye crop, in pixels: 144 wide by 36 tall, grayscale. */
const CROP_W = 144;
const CROP_H = 36;

type Stage = "start" | "camera" | "timesync" | "calibrate" | "validate" | "track";

const STAGES: { id: Stage; label: string }[] = [
  { id: "camera", label: "Camera" },
  { id: "timesync", label: "Time sync" },
  { id: "calibrate", label: "Calibrate" },
  { id: "validate", label: "Validate" },
  { id: "track", label: "Free viewing" },
];

interface Stats {
  fps: number;
  faceFound: boolean;
  clock: string;
  dropped: number;
}

interface Sample {
  x: number;
  y: number;
  t: number;
}

// ---------------------------------------------------------------------------------------
// environment sniffing (advisory only — nothing here gates the demo)

interface Environment {
  webgpu: boolean;
  rvfc: boolean;
  secure: boolean;
  media: boolean;
  browser: "chrome" | "safari" | "firefox" | "other";
}

function readEnvironment(): Environment {
  const ua = navigator.userAgent;
  const chrome = /Chrome|Chromium|Edg\//.test(ua) && !/OPR\//.test(ua);
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
  const firefox = /Firefox/.test(ua);
  return {
    webgpu: "gpu" in navigator,
    rvfc:
      typeof HTMLVideoElement !== "undefined" &&
      "requestVideoFrameCallback" in HTMLVideoElement.prototype,
    secure: window.isSecureContext,
    media: !!navigator.mediaDevices?.getUserMedia,
    browser: chrome ? "chrome" : safari ? "safari" : firefox ? "firefox" : "other",
  };
}

// ---------------------------------------------------------------------------------------
// small presentational helpers

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={clsx(styles.statValue, tone && styles[tone])}>{value}</span>
    </div>
  );
}

function Progress({ fraction, label }: { fraction: number; label: string }) {
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
      <span className={styles.progressLabel}>
        {label} · {pct}%
      </span>
    </div>
  );
}

/**
 * The full-viewport target overlay used by calibration and validation. Coordinates are
 * viewport fractions, which is exactly what the core hands to `showTarget`, so no
 * conversion is needed beyond turning them into percentages.
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
  // Portalled to <body>: the targets are placed in viewport fractions, and a `position:
  // fixed` element is trapped by any ancestor with a transform or a filter — which the
  // theme is free to add to the article column at any point.
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
  const readoutRef = useRef<HTMLElement | null>(null);
  const bufferRef = useRef<Sample[]>([]);
  const statsRef = useRef<Stats>({ fps: 0, faceFound: false, clock: "—", dropped: 0 });
  const showGazeRef = useRef(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const [env] = useState<Environment>(() => readEnvironment());
  const [stage, setStage] = useState<Stage>("start");
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<"webgpu" | "wasm" | null>(null);
  const [stats, setStats] = useState<Stats>(statsRef.current);
  const [progress, setProgress] = useState(0);
  const [loopback, setLoopback] = useState<LoopbackResult | null>(null);
  const [calibration, setCalibration] = useState<{ nPoints: number; lambda: number } | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [target, setTarget] = useState<Gaze | null>(null);
  const [phase, setPhase] = useState<"settle" | "capture">("settle");
  const [overlayCaption, setOverlayCaption] = useState("");

  const done = useCallback(
    (s: Stage) => STAGES.findIndex((x) => x.id === s) < STAGES.findIndex((x) => x.id === stage),
    [stage],
  );

  // -- per-frame work, done imperatively so 30 fps never becomes 30 React renders/second --
  const handleFrame = useCallback((frame: TrackerFrame) => {
    statsRef.current = {
      fps: frame.fps,
      faceFound: frame.faceFound,
      clock: frame.time.source,
      dropped: statsRef.current.dropped + (frame.time.dropped ?? 0),
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
      if (readoutRef.current) {
        readoutRef.current.textContent =
          `x ${px.toFixed(0)} px   y ${py.toFixed(0)} px   t ${t.toFixed(1)} ms` +
          `   (${buffer.length} samples buffered)`;
      }
    }
  }, []);

  // Flush the frame stats into React at a human rate.
  useEffect(() => {
    if (stage === "start") return;
    const id = window.setInterval(() => setStats({ ...statsRef.current }), 250);
    return () => window.clearInterval(id);
  }, [stage]);

  // Tear the tracker down when the visitor navigates away.
  useEffect(
    () => () => {
      unsubscribeRef.current?.();
      trackerRef.current?.dispose();
      trackerRef.current = null;
    },
    [],
  );

  const fail = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (/NotAllowed|Permission denied/i.test(message)) {
      setError(
        "The browser refused access to the camera. Allow it for this site (the padlock in " +
          "the address bar) and reload the page. Nothing is uploaded — every frame is " +
          "processed and discarded locally.",
      );
    } else if (/NotFound|NotReadable|Device/i.test(message)) {
      setError(`No usable camera was found: ${message}`);
    } else if (/eye_embedding|onnx|fetch|404/i.test(message)) {
      setError(
        `The eye-embedding model could not be loaded (${message}). If you are running this ` +
          "site locally, the model is copied into `static/models/` by `npm run predev`.",
      );
    } else {
      setError(message);
    }
    setBusy(null);
  }, []);

  // -- step 1: camera ---------------------------------------------------------------------
  const startCamera = useCallback(async () => {
    setError(null);
    setBusy("Requesting the camera and loading the model (about 20 MB, cached afterwards)…");
    try {
      const { SaccadeTracker } = await import("saccadejs");
      const tracker = new SaccadeTracker({ assets: { modelUrl }, tta: 5 });
      const info = await tracker.init();
      trackerRef.current = tracker;
      setBackend(info.ep);
      unsubscribeRef.current = tracker.onFrame(handleFrame);

      const slot = videoSlotRef.current;
      if (slot && !slot.contains(tracker.video)) {
        // Add, don't assign: the tracker may already have classes of its own on the element.
        tracker.video.classList.add(styles.video);
        tracker.video.setAttribute("aria-label", "Live camera preview, mirrored");
        slot.appendChild(tracker.video);
      }
      tracker.start();
      setStage("camera");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }, [fail, handleFrame, modelUrl]);

  // -- step 2: time sync ------------------------------------------------------------------
  const runTimeSync = useCallback(async () => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    setError(null);
    setProgress(0);
    setBusy(
      "Measuring screen-to-camera lag — the page will change brightness slowly for 15 seconds.",
    );
    try {
      const { runLoopback } = await import("saccadejs");
      const result = await runLoopback(tracker, {
        durationMs: LOOPBACK_MS,
        onProgress: setProgress,
      });
      setLoopback(result);
      setStage("timesync");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }, [fail]);

  // -- steps 3 and 4: calibration and validation -------------------------------------------
  const ui = {
    showTarget: (t: Gaze | null, p: "settle" | "capture") => {
      setTarget(t);
      setPhase(p);
    },
  };

  const runCalibrate = useCallback(async () => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    setError(null);
    setOverlayCaption("Look at each dot. It turns green while the sample is taken.");
    setBusy("Calibrating…");
    try {
      const { runCalibration, defaultGrid13 } = await import("saccadejs");
      tracker.clearCalibration();
      const points: CalPoint[] = await runCalibration(
        tracker,
        defaultGrid13(),
        { settleMs: SETTLE_MS, captureMs: CAPTURE_MS },
        ui,
      );
      const fit = tracker.fitCalibration();
      if (!fit) throw new Error(`Calibration failed: only ${points.length} usable points.`);
      setCalibration(fit);
      setValidation(null);
      setStage("calibrate");
    } catch (err) {
      fail(err);
    } finally {
      setTarget(null);
      setBusy(null);
    }
  }, [fail]);

  const runValidate = useCallback(async () => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    setError(null);
    setOverlayCaption("Nine new points, none of them used for calibration.");
    setBusy("Validating…");
    try {
      const { runValidation, validationGrid9 } = await import("saccadejs");
      const result = await runValidation(
        tracker,
        validationGrid9(),
        {
          settleMs: SETTLE_MS,
          captureMs: CAPTURE_MS * 4,
          roiRadiusPx: ROI_RADIUS_PX,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        },
        ui,
      );
      setValidation(result);
      setStage("validate");
    } catch (err) {
      fail(err);
    } finally {
      setTarget(null);
      setBusy(null);
    }
  }, [fail]);

  // -- step 5: free viewing ----------------------------------------------------------------
  const startFreeViewing = useCallback(() => {
    bufferRef.current = [];
    showGazeRef.current = true;
    setStage("track");
  }, []);

  const stopFreeViewing = useCallback(() => {
    showGazeRef.current = false;
    if (gazeDotRef.current) gazeDotRef.current.style.opacity = "0";
    setStage("validate");
  }, []);

  const downloadSamples = useCallback(() => {
    const payload = {
      generated: new Date().toISOString(),
      note:
        "x and y are pixels in this browser window; t is performance.now() at the camera's " +
        "capture time, averaged over the test-time-augmentation window.",
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
  const started = stage !== "start";

  return (
    <div className={styles.demo}>
      {!env.secure || !env.media ? (
        <div className={clsx(styles.notice, styles.noticeBad)}>
          This browser cannot open a camera here. <code>getUserMedia</code> needs a secure context —
          open the page over <code>https://</code> or on <code>localhost</code>.
        </div>
      ) : null}

      {env.browser !== "chrome" ? (
        <div className={clsx(styles.notice, styles.noticeWarn)}>
          <strong>Chrome or Edge is recommended.</strong>{" "}
          {env.rvfc
            ? "This browser supports requestVideoFrameCallback, so frames are timestamped, but WebGPU may be unavailable and the demo will fall back to the slower WebAssembly backend."
            : "This browser does not expose requestVideoFrameCallback, so camera frames carry no capture timestamp and the demo falls back to the animation-frame clock. Gaze still works; timing does not."}{" "}
          {env.browser === "safari"
            ? "Safari in particular has no WebGPU on by default and no captureTime."
            : null}
        </div>
      ) : null}

      {!env.webgpu && env.secure ? (
        <div className={clsx(styles.notice, styles.noticeWarn)}>
          WebGPU is not available in this browser, so the model will run on the WebAssembly backend.
          Everything works; expect a lower frame rate.
        </div>
      ) : null}

      <ol className={styles.stepper} role="list">
        {STAGES.map((s) => (
          <li
            key={s.id}
            className={clsx(
              styles.stepperItem,
              stage === s.id && styles.stepperCurrent,
              done(s.id) && styles.stepperDone,
            )}
          >
            {s.label}
          </li>
        ))}
      </ol>

      {error ? <div className={clsx(styles.notice, styles.noticeBad)}>{error}</div> : null}

      {/* ------------------------------------------------------------------ 1. camera --- */}
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>1 · Start the camera</h3>
        {!started ? (
          <>
            <p>
              The demo asks for your camera, downloads a 20 MB model, and runs entirely in this tab.
              No video, no image and no gaze sample leaves your machine.
            </p>
            <button className={styles.primary} onClick={startCamera} disabled={!!busy}>
              Start camera
            </button>
          </>
        ) : (
          <div className={styles.previewRow}>
            <div className={styles.videoWrap} ref={videoSlotRef} />
            <div className={styles.cropWrap}>
              <canvas
                ref={cropCanvasRef}
                width={CROP_W}
                height={CROP_H}
                className={styles.crop}
                aria-label="The 144 by 36 pixel eye crop fed to the model"
              />
              <span className={styles.cropCaption}>144 × 36 eye crop → model input</span>
            </div>
            <div className={styles.statGrid}>
              <Stat
                label="Face"
                value={stats.faceFound ? "found" : "not found"}
                tone={stats.faceFound ? "good" : "warn"}
              />
              <Stat label="Frame rate" value={`${stats.fps.toFixed(0)} fps`} />
              <Stat
                label="Backend"
                value={backend ?? "—"}
                tone={backend === "webgpu" ? "good" : "warn"}
              />
              <Stat
                label="Frame clock"
                value={stats.clock}
                tone={stats.clock === "captureTime" ? "good" : "warn"}
              />
            </div>
          </div>
        )}
      </section>

      {/* --------------------------------------------------------------- 2. time sync --- */}
      {started ? (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>2 · Measure the timing offset</h3>
          <p>
            For fifteen seconds the page steps between black and white at random intervals longer
            than half a second — no flicker — while the camera watches the screen. The delay between
            the flip and the frame that sees it is the whole screen-to-camera lag in one number.
          </p>
          {busy && progress > 0 ? <Progress fraction={progress} label="Time sync" /> : null}
          {loopback ? (
            <div className={styles.resultCard}>
              <div className={styles.statGrid}>
                <Stat label="Lag" value={`${loopback.lagMs.toFixed(1)} ms`} />
                <Stat label="Plateau width" value={`${loopback.plateauWidthMs.toFixed(1)} ms`} />
                <Stat
                  label="Verdict"
                  value={loopback.verdict}
                  tone={
                    loopback.verdict === "OK"
                      ? "good"
                      : loopback.verdict === "INCONCLUSIVE"
                        ? "warn"
                        : "bad"
                  }
                />
                <Stat
                  label="Halves"
                  value={`${loopback.halves.first.toFixed(0)} / ${loopback.halves.second.toFixed(0)} ms`}
                />
              </div>
              <p className={styles.explain}>
                {loopback.verdict === "OK" ? (
                  <>
                    A frame stamped <code>t</code> shows what was on screen about{" "}
                    <strong>{loopback.lagMs.toFixed(0)} ms</strong> earlier, so subtracting that
                    much puts gaze samples back on the experiment's clock. The plateau is{" "}
                    {loopback.plateauWidthMs.toFixed(0)} ms wide — the estimate is only ever as
                    sharp as one camera frame — and the two halves of the run agree to{" "}
                    {Math.abs(loopback.halves.first - loopback.halves.second).toFixed(0)} ms.
                  </>
                ) : (
                  <>
                    The run did not produce a usable number
                    {loopback.reason ? ` (${loopback.reason})` : ""}. That is the point of reporting
                    a verdict: a bad measurement announces itself instead of quietly shifting your
                    data. Try again with the window focused and nothing else animating on screen.
                  </>
                )}
              </p>
            </div>
          ) : null}
          <button className={styles.primary} onClick={runTimeSync} disabled={!!busy}>
            {loopback ? "Measure again" : "Run the 15 s time sync"}
          </button>
        </section>
      ) : null}

      {/* --------------------------------------------------------------- 3. calibrate --- */}
      {started ? (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>3 · Calibrate</h3>
          <p>
            Thirteen points. Each shows a shrinking ring for one second while your eyes settle, then
            turns green for half a second while embeddings are collected. Sit still, move only your
            eyes, and keep the room lighting on your face rather than behind it.
          </p>
          {calibration ? (
            <div className={styles.resultCard}>
              <div className={styles.statGrid}>
                <Stat label="Points fitted" value={`${calibration.nPoints}`} tone="good" />
                <Stat label="Ridge λ" value={`${calibration.lambda}`} />
              </div>
            </div>
          ) : null}
          <button className={styles.primary} onClick={runCalibrate} disabled={!!busy}>
            {calibration ? "Recalibrate" : "Start calibration"}
          </button>
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- 4. validate --- */}
      {started && calibration ? (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>4 · Validate</h3>
          <p>
            Nine fresh points that the calibration never saw, so the number below is an honest
            held-out error rather than a fit statistic.
          </p>
          {validation ? (
            <div className={styles.resultCard}>
              <div className={styles.statGrid}>
                <Stat
                  label="Median error"
                  value={`${(validation.medianErrorViewport * 100).toFixed(1)}% of the viewport`}
                  tone={validation.medianErrorViewport < 0.1 ? "good" : "warn"}
                />
                <Stat label="Mean error" value={`${validation.meanErrorPx.toFixed(0)} px`} />
                <Stat
                  label={`Within ${ROI_RADIUS_PX} px`}
                  value={`${validation.percentInRoi.toFixed(0)}%`}
                />
              </div>
              <p className={styles.explain}>
                Webcam gaze is a coarse instrument. Expect something in the region of a tenth of the
                screen; design your regions of interest to be larger than the error you actually
                measure, and report the validation numbers with your results.
              </p>
            </div>
          ) : null}
          <button className={styles.primary} onClick={runValidate} disabled={!!busy}>
            {validation ? "Validate again" : "Start validation"}
          </button>
        </section>
      ) : null}

      {/* -------------------------------------------------------------- 5. free gaze --- */}
      {started && calibration ? (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>5 · Free viewing</h3>
          <p>
            A dot follows your gaze anywhere in the window. Every sample is buffered for ten seconds
            so you can download exactly what the extension would hand to jsPsych.
          </p>
          <pre className={styles.readout}>
            <code ref={readoutRef}>waiting for a gaze estimate…</code>
          </pre>
          <div className={styles.buttonRow}>
            {stage === "track" ? (
              <button className={styles.secondary} onClick={stopFreeViewing}>
                Stop
              </button>
            ) : (
              <button className={styles.primary} onClick={startFreeViewing} disabled={!!busy}>
                Show the gaze dot
              </button>
            )}
            <button
              className={styles.secondary}
              onClick={downloadSamples}
              disabled={stage !== "track"}
            >
              Download the last 10 s as JSON
            </button>
          </div>
        </section>
      ) : null}

      {busy && progress === 0 ? <p className={styles.busy}>{busy}</p> : null}

      {createPortal(
        <div
          ref={gazeDotRef}
          className={styles.gazeDot}
          style={{ opacity: 0 }}
          aria-hidden="true"
        />,
        document.body,
      )}
      <TargetOverlay target={target} phase={phase} caption={overlayCaption} />
    </div>
  );
}

export default function LiveDemo(): React.ReactNode {
  return <BrowserOnly fallback={<p>Loading the demo…</p>}>{() => <Demo />}</BrowserOnly>;
}
