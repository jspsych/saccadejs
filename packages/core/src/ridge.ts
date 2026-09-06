import type { CalHead, Gaze, RidgeRow } from "./types";
import { EMB_DIM } from "./types";

const RIDGE_EPS = 1e-7;

export function calWeight(e: Float32Array, head: CalHead): number {
  let s = head.bias;
  for (let i = 0; i < e.length; i++) s += head.kernel[i] * e[i];
  return 1 / (1 + Math.exp(-s));
}

export function solveRidge(rows: RidgeRow[], lambda: number, center = 0.5): Float32Array {
  const d = EMB_DIM;
  const a = new Float64Array(d * d);
  const b = new Float64Array(d * 2);
  const xw = new Float64Array(d);

  for (const r of rows) {
    const s = Math.sqrt(r.w + RIDGE_EPS);
    for (let i = 0; i < d; i++) xw[i] = r.e[i] * s;
    const yx = (r.x - center) * s;
    const yy = (r.y - center) * s;
    for (let i = 0; i < d; i++) {
      const v = xw[i];
      if (v !== 0) {
        const ro = i * d;
        for (let j = i; j < d; j++) a[ro + j] += v * xw[j];
      }
      b[i * 2] += v * yx;
      b[i * 2 + 1] += v * yy;
    }
  }
  for (let i = 0; i < d; i++) {
    a[i * d + i] += lambda;
    for (let j = 0; j < i; j++) a[i * d + j] = a[j * d + i];
  }

  // Cholesky: A = L L^T (in-place lower triangle of `a`).
  for (let i = 0; i < d; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i * d + j];
      for (let k = 0; k < j; k++) sum -= a[i * d + k] * a[j * d + k];
      if (i === j) {
        a[i * d + j] = Math.sqrt(sum);
      } else {
        a[i * d + j] = sum / a[j * d + j];
      }
    }
  }

  const y = new Float64Array(d * 2);
  for (let i = 0; i < d; i++) {
    let s0 = b[i * 2];
    let s1 = b[i * 2 + 1];
    for (let k = 0; k < i; k++) {
      s0 -= a[i * d + k] * y[k * 2];
      s1 -= a[i * d + k] * y[k * 2 + 1];
    }
    const l = a[i * d + i];
    y[i * 2] = s0 / l;
    y[i * 2 + 1] = s1 / l;
  }

  const out = new Float64Array(d * 2);
  for (let i = d - 1; i >= 0; i--) {
    let s0 = y[i * 2];
    let s1 = y[i * 2 + 1];
    for (let k = i + 1; k < d; k++) {
      s0 -= a[k * d + i] * out[k * 2];
      s1 -= a[k * d + i] * out[k * 2 + 1];
    }
    const l = a[i * d + i];
    out[i * 2] = s0 / l;
    out[i * 2 + 1] = s1 / l;
  }

  return Float32Array.from(out);
}

export function predict(e: Float32Array, kernel: Float32Array, center = 0.5): Gaze {
  let x = 0;
  let y = 0;
  for (let i = 0; i < e.length; i++) {
    x += e[i] * kernel[i * 2];
    y += e[i] * kernel[i * 2 + 1];
  }
  return { x: x + center, y: y + center };
}
