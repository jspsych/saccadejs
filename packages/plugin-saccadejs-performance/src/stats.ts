/**
 * The numbers `saccade-performance` reports, kept apart from the trial so they can be tested
 * without a DOM, a camera or a model.
 *
 * Two things about the tracker shape everything here.
 *
 * The pipeline keeps exactly one `session.run` in flight and schedules the next camera frame
 * only after the current one has been through landmark -> crop -> embed, so the rate at which
 * frames arrive *is* the rate at which gaze samples are produced. There is no separate
 * "inference rate" to measure: the loop rate is bounded by whichever of camera delivery or
 * inference is slower, which is exactly the quantity a researcher wants to gate on.
 *
 * A frame with no face in it never reaches the model at all — `Pipeline.startEmbed` returns
 * early without an eye crop — so those frames come back at the camera's own rate and would
 * flatter a machine that cannot keep up. They are counted, reported, and then kept out of every
 * rate statistic.
 */

/** One frame, reduced to what the statistics need. */
export interface FrameSample {
  /** Capture timestamp, in ms on the `performance.now()` timeline. */
  t: number;
  /** Whether a face was found in this frame. */
  faceFound: boolean;
  /** Inference time for this frame in ms, or 0 if the frame never reached the model. */
  embedMs: number;
  /** Camera frames presented but never seen by the loop since the previous frame. */
  dropped: number;
}

export interface PerformanceStats {
  fps_median: number | null;
  fps_mean: number | null;
  fps_p10: number | null;
  frames: number;
  frames_without_face: number;
  dropped: number;
  embed_ms_median: number | null;
}

/**
 * Reduce a measurement window to the reported statistics.
 *
 * Rates are derived from the intervals between *consecutive* frames that both contained a face.
 * Skipping an interval that straddles a face-less frame matters: such an interval spans the gap
 * as though it were one very slow frame, which would drag the slow tail down for a reason that
 * has nothing to do with how fast the machine is.
 */
export function summarise(samples: FrameSample[]): PerformanceStats {
  const intervals: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (!prev.faceFound || !cur.faceFound) continue;
    const dt = cur.t - prev.t;
    // A non-positive interval means two frames carried the same capture timestamp (a camera
    // that repeats one, or a `performance.now()` fallback under a coarse clock). It cannot be
    // turned into a rate.
    if (dt > 0) intervals.push(dt);
  }

  const embeds = samples.filter((s) => s.faceFound && s.embedMs > 0).map((s) => s.embedMs);
  const total = intervals.reduce((a, b) => a + b, 0);

  return {
    // The typical rate: half the frames arrived faster than this, half slower.
    fps_median: rate(median(intervals)),
    // Frames per second over the whole window, which is what `frames / duration` would give.
    // Reported as well as the median because it is the number most people mean by "fps".
    fps_mean: total > 0 ? (intervals.length / total) * 1000 : null,
    // The slow tail: the rate at the 90th percentile of intervals. A machine that stalls
    // periodically — thermal throttling, a busy background tab — can have a healthy median and
    // an unusable p10, and the median alone will not show it.
    fps_p10: rate(quantile(intervals, 0.9)),
    frames: samples.filter((s) => s.faceFound).length,
    frames_without_face: samples.filter((s) => !s.faceFound).length,
    dropped: samples.reduce((a, s) => a + s.dropped, 0),
    embed_ms_median: median(embeds),
  };
}

/** Turn an interval in ms into a rate in Hz, propagating "could not be measured". */
function rate(ms: number | null): number | null {
  return ms === null || ms <= 0 ? null : 1000 / ms;
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

/**
 * The `p`th quantile of `values` by linear interpolation between order statistics — the same
 * definition as R's `type = 7` and NumPy's default, so a number reported here matches one
 * computed from `raw` in an analysis script.
 */
export function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (pos - lower) * (sorted[upper] - sorted[lower]);
}
