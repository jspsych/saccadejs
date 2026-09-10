import calWeights from "./generated/cal_weights.json";
import manifest from "./generated/export_manifest.json";
import { calWeight, solveRidge } from "./ridge";
import type { CalHead, CalPoint, CalWeighting, Gaze, RidgeRow } from "./types";

/** Targets are centred on this before the ridge fit, and the prediction adds it back. */
export const CENTER: number = manifest.ridge.center;

/**
 * The logistic head exported alongside eye-embedding 1.0.0.
 *
 * Off by default. It is one model's weighting scheme in one linear layer, and it produces
 * meaningless scores on another model's embeddings, so it is an explicit opt-in
 * (`SaccadeTrackerOptions.calHead`) for studies reproducing how 1.0.0 weighted its rows.
 */
export const CAL_HEAD: CalHead = calWeights as CalHead;

export const DEFAULT_SETTLE_MS = 1000;
export const DEFAULT_CAPTURE_MS = 500;

/** 13 points: a 3x3 grid at 5/50/95 % plus four inner points. The calibration default. */
export function defaultGrid13(): Gaze[] {
  const c = [0.05, 0.5, 0.95];
  const points: Gaze[] = [];
  for (const y of c) for (const x of c) points.push({ x, y });
  for (const y of [0.275, 0.725]) for (const x of [0.275, 0.725]) points.push({ x, y });
  return points;
}

/** 20 points (4 x 5): denser calibration, used when accuracy matters more than time. */
export function trainingGrid20(): Gaze[] {
  const xs = [0.05, 0.35, 0.65, 0.95];
  const ys = [0.05, 0.275, 0.5, 0.725, 0.95];
  const points: Gaze[] = [];
  for (const y of ys) for (const x of xs) points.push({ x, y });
  return points;
}

/** 9 points inset to 15/50/85 %, for validation (never the same points as the fit). */
export function validationGrid9(): Gaze[] {
  const c = [0.15, 0.5, 0.85];
  const points: Gaze[] = [];
  for (const y of c) for (const x of c) points.push({ x, y });
  return points;
}

/** Ridge penalty: heavier with few points, where overfitting is the real risk. */
export function lambdaFor(nPoints: number): number {
  return nPoints <= 9 ? manifest.ridge.lambda_fewpoint : manifest.ridge.lambda_default;
}

/**
 * Mean of the embeddings collected at one target, optionally weighted per frame.
 *
 * Width comes from the embeddings themselves. Weighting happens here, before the mean, so a
 * low-scoring frame (a blink, a glance away) drops out of the point's embedding instead of
 * only discounting the finished point. Weights summing to ~0 -- every frame scored near zero
 * -- fall back to the plain mean; the row weight downstream handles a degenerate point better
 * than dividing by nothing here would.
 */
export function meanEmbedding(embeddings: Float32Array[], weights?: number[] | null): Float32Array {
  if (embeddings.length === 0) throw new Error("meanEmbedding: no embeddings");
  const d = embeddings[0].length;
  for (const e of embeddings) {
    if (e.length !== d) {
      throw new Error(
        `meanEmbedding: embedding lengths differ (${d} vs ${e.length}); the model's output ` +
          "length must be stable across a capture window.",
      );
    }
  }
  if (weights && weights.length !== embeddings.length) {
    throw new Error(
      `meanEmbedding: ${weights.length} weights for ${embeddings.length} embeddings; a ` +
        "partial set is not a weighting anyone chose.",
    );
  }
  const w = weights ?? null;
  const total = w ? w.reduce((a, b) => a + b, 0) : embeddings.length;
  const use = w && total > 1e-6 ? w : null;
  const denom = use ? total : embeddings.length;

  const mean = new Float32Array(d);
  for (let k = 0; k < embeddings.length; k++) {
    const e = embeddings[k];
    const f = use ? use[k] : 1;
    for (let i = 0; i < d; i++) mean[i] += e[i] * f;
  }
  for (let i = 0; i < d; i++) mean[i] /= denom;
  return mean;
}

/** Mean of a point's per-frame weights: the row weight for a model that emits them. */
function rowWeight(p: CalPoint): number | null {
  if (!p.weights || p.weights.length === 0) return null;
  let s = 0;
  for (const w of p.weights) s += w;
  return s / p.weights.length;
}

/**
 * Fit the embedding -> (x, y) ridge map from calibration points. Returns a kernel of `2 * d`
 * (x and y interleaved), where `d` is the model's embedding length.
 *
 * Row weights, in order of precedence:
 *
 *   1. `head` -- a `CalHead` the caller passed deliberately. An explicit argument wins.
 *   2. the per-frame weights the model emitted, averaged over the capture window.
 *   3. uniform. Not a degraded mode: every row at 1 is plain unweighted ridge.
 *
 * `weighting` names which of those ran, so callers can record the choice rather than infer it.
 */
export function fitRidge(
  cal: CalPoint[],
  head: CalHead | null = null,
  lambda: number = lambdaFor(cal.length),
  center: number = CENTER,
): { kernel: Float32Array; weighting: CalWeighting } {
  const weighted = cal.filter((p) => rowWeight(p) != null).length;
  if (!head && weighted > 0 && weighted < cal.length) {
    // Defaulting the unweighted points to 1 would quietly make them the most trusted rows in
    // the fit, which is the opposite of what a half-collected weighting implies.
    throw new Error(
      `fitRidge: ${weighted} of ${cal.length} calibration points carry model weights. Weight ` +
        "every point or none; a partial weighting silently favours the unweighted ones.",
    );
  }
  const weighting: CalWeighting = head ? "head" : weighted > 0 ? "model" : "uniform";

  const rows: RidgeRow[] = cal.map((p) => ({
    e: p.meanEmbedding,
    x: p.target.x,
    y: p.target.y,
    w: head ? calWeight(p.meanEmbedding, head) : (rowWeight(p) ?? 1),
  }));
  return { kernel: solveRidge(rows, lambda, center), weighting };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
