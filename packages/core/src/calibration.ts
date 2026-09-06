// Point-sequence drivers. They own the *timing* of a calibration or validation run
// (settle, then capture) and nothing about how a target looks: the caller draws.

import { median } from "./grids";
import type { SaccadeTracker } from "./tracker";
import type { CalPoint, Gaze } from "./types";

export interface CollectOptions {
  /** How long the target is shown before sampling starts, so the eye can land on it. */
  settleMs: number;
  /** How long samples are collected at each target. */
  captureMs: number;
}

export interface TargetUi {
  showTarget: (t: Gaze | null, phase: "settle" | "capture") => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  for (const target of targets) {
    ui.showTarget(target, "settle");
    await sleep(opts.settleMs);
    ui.showTarget(target, "capture");
    const embeddings: Float32Array[] = [];
    const until = performance.now() + opts.captureMs;
    while (performance.now() < until) {
      const e = await tracker.nextEmbedding();
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
  for (const target of targets) {
    ui.showTarget(target, "settle");
    await sleep(opts.settleMs);
    ui.showTarget(target, "capture");
    const samples: ValidationSample[] = [];
    const until = performance.now() + opts.captureMs;
    while (performance.now() < until) {
      const f = await tracker.nextFrame();
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
