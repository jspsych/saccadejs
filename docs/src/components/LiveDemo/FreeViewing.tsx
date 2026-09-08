import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import type { SaccadeTracker, TrackerFrame } from "@saccadejs/core";
import styles from "./styles.module.css";

/**
 * Free viewing: the tracker with the lid off.
 *
 * The other three activities are jsPsych trials, because that is how an experiment uses
 * saccade.js. This one is not, and deliberately so — it is the same `SaccadeTracker` those
 * trials are running on, driven straight from React with `tracker.onFrame`, which is all a page
 * outside jsPsych ever needs. Nothing is recorded and nothing is scored: the participant looks
 * wherever they like, and the dot follows.
 *
 * It exists to make one trade-off visible. `smoothing_frames` averages the last _n_ camera
 * frames into a single estimate, so raising it steadies the dot and makes it lag; the readouts
 * put numbers on both halves of that. Reading about it is not the same as watching your own
 * gaze arrive late.
 */

/** Smoothing settings the slider offers. One frame is the default: no smoothing at all. */
const SMOOTHING_MIN = 1;
const SMOOTHING_MAX = 15;

/** How long a point stays in the trail, in ms. Long enough to show a saccade's shape. */
const TRAIL_MS = 900;

/** How often the readouts are refreshed, in ms. Frames arrive three times as often; the numbers
 * are unreadable if they change that fast, and re-rendering React per frame would be silly. */
const READOUT_MS = 250;

interface Readout {
  fps: number;
  faceFound: boolean;
  gaze: { x: number; y: number } | null;
  /** Camera frames the browser reported dropping since this panel opened. */
  dropped: number;
  /** Estimates delivered per second — the rate an experiment would record data at. */
  hz: number;
}

const EMPTY_READOUT: Readout = { fps: 0, faceFound: false, gaze: null, dropped: 0, hz: 0 };

interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

export interface FreeViewingProps {
  tracker: SaccadeTracker;
  /** Smoothing this panel starts on, and reports back so the session remembers it. */
  smoothingFrames: number;
  onSmoothingChange: (n: number) => void;
  onExit: () => void;
}

export default function FreeViewing({
  tracker,
  smoothingFrames,
  onSmoothingChange,
  onExit,
}: FreeViewingProps): React.ReactNode {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<HTMLDivElement | null>(null);
  /** Every frame since the panel opened, in the fields the readouts need. Written at camera
   * rate and read on a timer, so none of this goes through React state. */
  const liveRef = useRef<Readout>({ ...EMPTY_READOUT });
  const trailRef = useRef<TrailPoint[]>([]);
  const stampsRef = useRef<number[]>([]);

  const [readout, setReadout] = useState<Readout>(EMPTY_READOUT);
  const [showTrail, setShowTrail] = useState(true);
  const [showCamera, setShowCamera] = useState(false);

  // ------------------------------------------------------------------- the frame subscription

  useEffect(() => {
    tracker.start();
    const unsubscribe = tracker.onFrame((frame: TrackerFrame) => {
      const now = performance.now();
      const live = liveRef.current;
      live.fps = frame.fps;
      live.faceFound = frame.faceFound;
      live.dropped += frame.time.dropped ?? 0;

      if (!frame.faceFound || !frame.gaze) {
        live.gaze = null;
        return;
      }
      // Gaze arrives as fractions of the viewport, which is exactly what a fixed-position
      // overlay wants: no scrolling or resizing has to be accounted for.
      const x = frame.gaze.x * window.innerWidth;
      const y = frame.gaze.y * window.innerHeight;
      live.gaze = { x, y };

      const stamps = stampsRef.current;
      stamps.push(now);
      while (stamps.length && now - stamps[0] > 1000) stamps.shift();
      live.hz = stamps.length;

      const trail = trailRef.current;
      trail.push({ x, y, t: now });
      while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();

      const dot = dotRef.current;
      if (dot) {
        dot.style.transform = `translate(${x}px, ${y}px)`;
        dot.classList.add(styles.dotVisible);
      }
    });

    return () => {
      unsubscribe();
      // The camera element may be sitting in this panel's preview box, which React is about to
      // remove — and a detached video gets no frames. Taking it out by hand and calling
      // `start()` puts it back in the tracker's own hidden holder now, rather than at the next
      // tick of the one-second watchdog; `stop()` then parks the frame loop until an activity
      // wants it again.
      tracker.video.remove();
      tracker.start();
      tracker.stop();
    };
  }, [tracker]);

  // The dot has to be hidden as soon as the face is lost, and that is a fact about frames that
  // did *not* arrive — the frame handler cannot see it. The readout timer can.
  useEffect(() => {
    const id = setInterval(() => {
      setReadout({ ...liveRef.current });
      const dot = dotRef.current;
      if (dot && !liveRef.current.gaze) dot.classList.remove(styles.dotVisible);
    }, READOUT_MS);
    return () => clearInterval(id);
  }, []);

  // ------------------------------------------------------------------- the trail

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showTrail) return;

    let handle = 0;
    const draw = () => {
      handle = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const now = performance.now();
      const trail = trailRef.current;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < trail.length; i++) {
        // Age, not index: at 30 fps a straight count would fade three times faster than at 90.
        const age = (now - trail[i].t) / TRAIL_MS;
        if (age > 1) continue;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(19, 178, 75, ${0.75 * (1 - age)})`;
        ctx.stroke();
      }
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [showTrail]);

  // ------------------------------------------------------------------- the camera preview

  // The camera element belongs to the tracker and is normally parked out of sight. Moving it
  // into the preview box is allowed and costs nothing; what is never allowed is hiding it with
  // `display: none` or dropping it out of the document, either of which stops the frames.
  useEffect(() => {
    const box = cameraRef.current;
    if (!showCamera || !box) return;
    box.appendChild(tracker.video);
  }, [showCamera, tracker]);

  const changeSmoothing = useCallback(
    (n: number) => {
      tracker.setSmoothingFrames(n);
      onSmoothingChange(n);
    },
    [onSmoothingChange, tracker],
  );

  // The window the gaze was averaged over sits, on average, half its length in the past.
  const lagMs = readout.fps > 0 ? (((smoothingFrames - 1) / 2) * 1000) / readout.fps : null;

  return (
    <>
      {createPortal(
        <>
          <canvas
            ref={canvasRef}
            className={styles.trail}
            style={{ display: showTrail ? "block" : "none" }}
          />
          <div ref={dotRef} className={styles.dot} />
        </>,
        document.body,
      )}

      <div className={styles.explore}>
        <div className={styles.exploreHead}>
          <h3 className={styles.exploreTitle}>Free viewing</h3>
          <p className={styles.exploreLead}>
            Nothing is being recorded. Look around the page — at this panel, at the words above it,
            out at the corners of the screen — and the dot follows. Keep your head where it was when
            you calibrated; move it and the estimate drifts.
          </p>
        </div>

        <dl className={styles.readouts}>
          <div className={styles.readout}>
            <dt>Camera</dt>
            <dd>{readout.fps ? `${readout.fps.toFixed(0)} fps` : "—"}</dd>
          </div>
          <div className={styles.readout}>
            <dt>Estimates</dt>
            <dd>{readout.hz ? `${readout.hz} Hz` : "—"}</dd>
          </div>
          <div className={styles.readout}>
            <dt>Smoothing lag</dt>
            <dd>{lagMs === null ? "—" : `${lagMs.toFixed(0)} ms`}</dd>
          </div>
          <div className={styles.readout}>
            <dt>Face</dt>
            <dd className={readout.faceFound ? styles.ok : styles.bad}>
              {readout.faceFound ? "found" : "not found"}
            </dd>
          </div>
          <div className={styles.readout}>
            <dt>Gaze</dt>
            <dd>
              {readout.gaze
                ? `${Math.round(readout.gaze.x)}, ${Math.round(readout.gaze.y)} px`
                : "—"}
            </dd>
          </div>
          <div className={styles.readout}>
            <dt>Dropped frames</dt>
            <dd>{readout.dropped}</dd>
          </div>
        </dl>

        <div className={styles.control}>
          <label className={styles.controlLabel} htmlFor="saccade-smoothing">
            <code>smoothing_frames</code>
            <span className={styles.controlValue}>
              {smoothingFrames} {smoothingFrames === 1 ? "frame" : "frames"}
            </span>
          </label>
          <input
            id="saccade-smoothing"
            className={styles.slider}
            type="range"
            min={SMOOTHING_MIN}
            max={SMOOTHING_MAX}
            step={1}
            value={smoothingFrames}
            onChange={(e) => changeSmoothing(Number(e.target.value))}
          />
          <p className={styles.controlHelp}>
            How many consecutive camera frames are averaged into one estimate. At 1 — the default —
            the dot is jumpy but current. Drag it up and the dot steadies and starts arriving late:
            that lag is the number above, and it is the reason a gaze-contingent design leaves this
            alone.
          </p>
        </div>

        <div className={styles.toggles}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={showTrail}
              onChange={(e) => setShowTrail(e.target.checked)}
            />
            Show the last {(TRAIL_MS / 1000).toFixed(1)} s as a trail
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={showCamera}
              onChange={(e) => setShowCamera(e.target.checked)}
            />
            Show the camera
          </label>
        </div>

        {/* The tracker's <video> lives in here while the preview is on. It is mirrored, like a
            bathroom mirror, so that moving left moves the image left — the pixels the model sees
            are never mirrored, only this copy of them. */}
        <div
          ref={cameraRef}
          className={clsx(styles.camera, showCamera && styles.cameraShown)}
          aria-hidden={!showCamera}
        />

        <div className={styles.buttonRow}>
          <button className={styles.primary} onClick={onExit}>
            Back to the menu
          </button>
        </div>
      </div>
    </>
  );
}
