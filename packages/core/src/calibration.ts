// Point-sequence drivers. They own the *timing* of a calibration or validation run
// (settle, then capture) and nothing about how a target looks: the caller draws.

import type { TimedEmbedding } from "./deferred";
import { predictSeries } from "./deferred";
import { median } from "./grids";
import type { SaccadeTracker } from "./tracker";
import type { CalPoint, EmbedResult, Gaze } from "./types";

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
  /**
   * Deferred mode only: called after the last target while the background workers finish the
   * run's frames, with how many are done out of how many. Nothing is on screen then unless the
   * caller puts it there, and on a slow machine the wait can be seconds.
   */
  processing?: (done: number, total: number) => void;
}

/** A frame queued for the background workers, and when it was captured. */
interface Owed {
  time: number;
  job: Promise<EmbedResult>;
}

/** Queue a frame's crop in deferred mode. The rejection is handled where the job is awaited. */
function owe(tracker: SaccadeTracker, crop: Uint8Array, time: number): Owed {
  const job = tracker.embedDeferred(crop);
  job.catch(() => undefined);
  return { time, job };
}

/**
 * Wait for every queued frame of a run, reporting progress, and return each target's frames
 * that were embedded, in capture order. Frames the workers dropped are left out.
 */
async function settleOwed(owed: Owed[][], ui: TargetUi): Promise<TimedEmbedding[][]> {
  const total = owed.reduce((n, frames) => n + frames.length, 0);
  let done = 0;
  ui.processing?.(0, total);
  return Promise.all(
    owed.map((frames) =>
      Promise.all(
        frames.map(({ time, job }) =>
          job
            .then(
              (r): TimedEmbedding | null => ({ ...r, time }),
              () => null,
            )
            .finally(() => ui.processing?.(++done, total)),
        ),
      ).then((rows) => rows.filter((r): r is TimedEmbedding => r !== null)),
    ),
  );
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
 *
 * In deferred mode the frames are queued for the background workers instead, and the points
 * are added once the workers have embedded them, after the last target (see `ui.processing`).
 */
export async function runCalibration(
  tracker: SaccadeTracker,
  targets: Gaze[],
  opts: CollectOptions,
  ui: TargetUi,
): Promise<CalPoint[]> {
  const out: CalPoint[] = [];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
  const deferred = tracker.mode === "deferred";
  const owed: Owed[][] = [];
  for (const target of targets) {
    ui.showTarget(target, "settle");
    await sleep(opts.settleMs);
    ui.showTarget(target, "capture");
    if (deferred) {
      const frames: Owed[] = [];
      const until = performance.now() + opts.captureMs;
      while (performance.now() < until) {
        const f = await withFrameTimeout(tracker.nextFrame(), timeoutMs);
        if (f.crop) frames.push(owe(tracker, f.crop, f.time.capture));
      }
      owed.push(frames);
      continue;
    }
    const embeddings: Float32Array[] = [];
    const weights: number[] = [];
    const until = performance.now() + opts.captureMs;
    while (performance.now() < until) {
      const s = await withFrameTimeout(tracker.nextSample(), timeoutMs);
      if (s) {
        embeddings.push(s.embedding);
        if (s.weight != null) weights.push(s.weight);
      }
    }
    if (embeddings.length === 0) continue;
    // Only a complete set of weights goes on: a partial one would quietly mean "the frames we
    // happened to score", which is not a weighting anyone chose.
    tracker.addCalibrationPoint(
      target,
      embeddings,
      weights.length === embeddings.length ? weights : null,
    );
    const points = tracker.getCalibrationPoints();
    out.push(points[points.length - 1]);
  }
  ui.showTarget(null, "capture");
  if (deferred) {
    const embedded = await settleOwed(owed, ui);
    embedded.forEach((frames, i) => {
      if (frames.length === 0) return;
      const weights = frames.every((f) => f.weight != null)
        ? frames.map((f) => f.weight as number)
        : null;
      tracker.addCalibrationPoint(
        targets[i],
        frames.map((f) => f.embedding),
        weights,
      );
      const points = tracker.getCalibrationPoints();
      out.push(points[points.length - 1]);
    });
  }
  return out;
}

export interface ValidationSample {
  gaze: Gaze;
  /** Capture time of the frame the sample came from (`meanCapture` when smoothing is on). */
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
 *
 * In deferred mode the gaze is computed once the background workers have embedded the run's
 * frames, after the last target, with the calibration that was in place during the run.
 */
export async function runValidation(
  tracker: SaccadeTracker,
  targets: Gaze[],
  opts: ValidationOptions,
  ui: TargetUi,
): Promise<ValidationResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
  const deferred = tracker.mode === "deferred";
  // The calibration in place during the run, which the gaze is computed with afterwards.
  const kernel = deferred ? tracker.getKernel() : null;
  const center = deferred ? tracker.getCenter() : 0;
  const live: ValidationSample[][] = [];
  const owed: Owed[][] = [];
  for (const target of targets) {
    ui.showTarget(target, "settle");
    await sleep(opts.settleMs);
    ui.showTarget(target, "capture");
    const samples: ValidationSample[] = [];
    const frames: Owed[] = [];
    const until = performance.now() + opts.captureMs;
    while (performance.now() < until) {
      const f = await withFrameTimeout(tracker.nextFrame(), timeoutMs);
      if (deferred) {
        if (f.crop && kernel) frames.push(owe(tracker, f.crop, f.time.capture));
      } else if (f.gaze) {
        samples.push({ gaze: f.gaze, time: f.time.meanCapture ?? f.time.capture });
      }
    }
    live.push(samples);
    owed.push(frames);
  }
  ui.showTarget(null, "capture");

  let collected = live;
  if (deferred) {
    const embedded = await settleOwed(owed, ui);
    const smoothing = tracker.getSmoothingFrames();
    collected = embedded.map((frames) =>
      kernel ? predictSeries(frames, kernel, smoothing, center) : [],
    );
  }
  const points = targets.map((target, i) => scorePoint(target, collected[i], opts));

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

function scorePoint(
  target: Gaze,
  samples: ValidationSample[],
  opts: ValidationOptions,
): ValidationPoint {
  const { width, height } = opts.viewport;
  if (samples.length === 0) {
    return {
      target,
      samples,
      meanGaze: { x: NaN, y: NaN },
      errorViewport: NaN,
      errorPx: NaN,
      percentInRoi: 0,
    };
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
  return {
    target,
    samples,
    meanGaze,
    errorViewport: Math.hypot(dx, dy),
    errorPx: Math.hypot(dx * width, dy * height),
    percentInRoi: (100 * inRoi) / samples.length,
  };
}
