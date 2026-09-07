// Point-sequence drivers. They own the *timing* of a calibration or validation run
// (settle, then capture) and nothing about how a target looks: the caller draws.

import { median } from "./grids";
import type { SaccadeTracker } from "./tracker";
import type { CalPoint, Gaze } from "./types";

/** Default for `CollectOptions.timeoutMs`: how long a capture waits for one camera frame. */
export const DEFAULT_FRAME_TIMEOUT_MS = 5000;

export interface CollectOptions {
  /** How long the target is shown before sampling starts, so the eye can land on it. */
  settleMs: number;
  /** How long samples are collected at each target. */
  captureMs: number;
  /**
   * How long to wait for a single camera frame before giving up, in ms.
   *
   * A frame source that has died — a `<video>` the host stopped rendering, a camera another
   * program took, a track that ended — never resolves `nextFrame()`, so without this the
   * capture loop waits forever and the trial freezes with nothing on screen to say why.
   * Rejects with `no camera frames for <ms> ms` instead, which the caller can display.
   * `0` (or any non-finite value) waits indefinitely.
   *
   * @default 5000
   */
  timeoutMs?: number;
}

export interface TargetUi {
  showTarget: (t: Gaze | null, phase: "settle" | "capture") => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reject `p` if it has not settled within `ms`, with a message a plugin can put on screen.
 *
 * Exported because the jsPsych extension's `calibratePoint` runs the same capture loop against
 * the same frame source and needs the same guard.
 */
export function withFrameTimeout<T>(p: Promise<T>, ms = DEFAULT_FRAME_TIMEOUT_MS): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no camera frames for ${ms} ms`)), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Walk `targets`: show each one, wait `settleMs`, collect embeddings for `captureMs`, and add
 * the point to the tracker's calibration set. Does not fit — call `tracker.fitCalibration()`.
 */
export async function runCalibration(
  tracker: SaccadeTracker,
  targets: Gaze[],
  opts: CollectOptions,
  ui: TargetUi,
): Promise<CalPoint[]> {
  const out: CalPoint[] = [];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
  for (const target of targets) {
    ui.showTarget(target, "settle");
    await sleep(opts.settleMs);
    ui.showTarget(target, "capture");
    const embeddings: Float32Array[] = [];
    const until = performance.now() + opts.captureMs;
    while (performance.now() < until) {
      const e = await withFrameTimeout(tracker.nextEmbedding(), timeoutMs);
      if (e) embeddings.push(e);
    }
    if (embeddings.length === 0) continue;
    tracker.addCalibrationPoint(target, embeddings);
    const points = tracker.getCalibrationPoints();
    out.push(points[points.length - 1]);
  }
  ui.showTarget(null, "capture");
  return out;
}

export interface ValidationSample {
  gaze: Gaze;
  /** Capture time of the frame the sample came from (`meanCapture` when TTA is on). */
  time: number;
}

export interface ValidationPoint {
  target: Gaze;
  samples: ValidationSample[];
  meanGaze: Gaze;
  /** Euclidean error in viewport fractions. */
  errorViewport: number;
  /** The same error in pixels, using the viewport passed in. */
  errorPx: number;
  /** Percentage (0-100) of samples within `roiRadiusPx` of the target. */
  percentInRoi: number;
}

export interface ValidationResult {
  points: ValidationPoint[];
  medianErrorViewport: number;
  meanErrorPx: number;
  percentInRoi: number;
}

export interface ValidationOptions extends CollectOptions {
  roiRadiusPx: number;
  viewport: { width: number; height: number };
}

/**
 * Same walk as `runCalibration`, but collects *gaze* (so the tracker must be calibrated) and
 * scores it against the targets. Points that produced no gaze are reported with NaN errors
 * rather than dropped, so the caller can see which targets failed.
 */
export async function runValidation(
  tracker: SaccadeTracker,
  targets: Gaze[],
  opts: ValidationOptions,
  ui: TargetUi,
): Promise<ValidationResult> {
  const { width, height } = opts.viewport;
  const points: ValidationPoint[] = [];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
  for (const target of targets) {
    ui.showTarget(target, "settle");
    await sleep(opts.settleMs);
    ui.showTarget(target, "capture");
    const samples: ValidationSample[] = [];
    const until = performance.now() + opts.captureMs;
    while (performance.now() < until) {
      const f = await withFrameTimeout(tracker.nextFrame(), timeoutMs);
      if (f.gaze) samples.push({ gaze: f.gaze, time: f.time.meanCapture ?? f.time.capture });
    }
    if (samples.length === 0) {
      points.push({
        target,
        samples,
        meanGaze: { x: NaN, y: NaN },
        errorViewport: NaN,
        errorPx: NaN,
        percentInRoi: 0,
      });
      continue;
    }
    let mx = 0;
    let my = 0;
    let inRoi = 0;
    for (const s of samples) {
      mx += s.gaze.x;
      my += s.gaze.y;
      const dpx = (s.gaze.x - target.x) * width;
      const dpy = (s.gaze.y - target.y) * height;
      if (Math.hypot(dpx, dpy) <= opts.roiRadiusPx) inRoi++;
    }
    const meanGaze = { x: mx / samples.length, y: my / samples.length };
    const dx = meanGaze.x - target.x;
    const dy = meanGaze.y - target.y;
    points.push({
      target,
      samples,
      meanGaze,
      errorViewport: Math.hypot(dx, dy),
      errorPx: Math.hypot(dx * width, dy * height),
      percentInRoi: (100 * inRoi) / samples.length,
    });
  }
  ui.showTarget(null, "capture");

  const viewportErrors = points.map((p) => p.errorViewport).filter((v) => Number.isFinite(v));
  const pxErrors = points.map((p) => p.errorPx).filter((v) => Number.isFinite(v));
  const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
  return {
    points,
    medianErrorViewport: median(viewportErrors) ?? NaN,
    meanErrorPx: mean(pxErrors),
    percentInRoi: mean(points.map((p) => p.percentInRoi)),
  };
}
