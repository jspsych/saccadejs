import calWeights from "./generated/cal_weights.json";
import manifest from "./generated/export_manifest.json";
import { calWeight, solveRidge } from "./ridge";
import type { CalHead, CalPoint, Gaze, RidgeRow } from "./types";
import { EMB_DIM } from "./types";

/** Targets are centred on this before the ridge fit, and the prediction adds it back. */
export const CENTER: number = manifest.ridge.center;

/** The logistic head shipped with the model; weights each calibration row. */
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

export function meanEmbedding(embeddings: Float32Array[]): Float32Array {
  const mean = new Float32Array(EMB_DIM);
  for (const e of embeddings) for (let i = 0; i < EMB_DIM; i++) mean[i] += e[i];
  for (let i = 0; i < EMB_DIM; i++) mean[i] /= embeddings.length;
  return mean;
}

/** Fit the 128 -> (x, y) ridge map from calibration points. Returns the 256-long kernel. */
export function fitRidge(
  cal: CalPoint[],
  head: CalHead = CAL_HEAD,
  lambda: number = lambdaFor(cal.length),
  center: number = CENTER,
): Float32Array {
  const rows: RidgeRow[] = cal.map((p) => ({
    e: p.meanEmbedding,
    x: p.target.x,
    y: p.target.y,
    w: calWeight(p.meanEmbedding, head),
  }));
  return solveRidge(rows, lambda, center);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
