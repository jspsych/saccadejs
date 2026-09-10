import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { fitRidge, lambdaFor } from "../src/grids";
import { calWeight, predict, solveRidge } from "../src/ridge";
import type { RidgeRow } from "../src/types";

const FIX = join(__dirname, "fixtures", "preproc");
const WP1 = join(__dirname, "fixtures");

interface RidgeCase {
  lambda: number;
  center: number;
  embeddings: number[][];
  coords: number[][];
  weights: number[];
  kernel: number[][];
  probes: number[][];
  predictions: number[][];
  head: { kernel: number[]; bias: number };
  head_weights: number[];
}

const c: RidgeCase = JSON.parse(readFileSync(join(FIX, "ridge_case.json"), "utf8"));

const rows: RidgeRow[] = c.embeddings.map((e, i) => ({
  e: Float32Array.from(e),
  x: c.coords[i][0],
  y: c.coords[i][1],
  w: c.weights[i],
}));

function maxAbs(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("solveRidge", () => {
  it("matches numpy solve", () => {
    const k = solveRidge(rows, c.lambda, c.center);
    expect(k.length).toBe(256);
    expect(maxAbs(Array.from(k), c.kernel.flat())).toBeLessThan(1e-5);
  });

  it("matches numpy predictions", () => {
    const k = solveRidge(rows, c.lambda, c.center);
    let m = 0;
    c.probes.forEach((p, i) => {
      const g = predict(Float32Array.from(p), k, c.center);
      m = Math.max(m, Math.abs(g.x - c.predictions[i][0]), Math.abs(g.y - c.predictions[i][1]));
    });
    expect(m).toBeLessThan(1e-5);
  });

  it("reproduces the calibration targets it was fit on (small lambda)", () => {
    const k = solveRidge(rows, 1e-4, c.center);
    let m = 0;
    rows.forEach((r) => {
      const g = predict(r.e, k, c.center);
      m = Math.max(m, Math.abs(g.x - r.x), Math.abs(g.y - r.y));
    });
    expect(m).toBeLessThan(1e-3);
  });
});

describe("calWeight", () => {
  it("matches the numpy sigmoid head", () => {
    let m = 0;
    c.embeddings.forEach((e, i) => {
      const w = calWeight(Float32Array.from(e), c.head);
      m = Math.max(m, Math.abs(w - c.head_weights[i]));
    });
    expect(m).toBeLessThan(1e-6);
  });
});

describe("lambdaFor", () => {
  it("penalises harder when there are few points", () => {
    expect(lambdaFor(9)).toBe(3);
    expect(lambdaFor(13)).toBe(1);
    expect(lambdaFor(20)).toBe(1);
  });
});

describe("fitRidge", () => {
  it("uses the shipped head to weight rows, matching a hand-built solve", () => {
    const cal = c.embeddings.slice(0, 8).map((e, i) => ({
      target: { x: c.coords[i][0], y: c.coords[i][1] },
      embeddings: [Float32Array.from(e)],
      weights: null,
      meanEmbedding: Float32Array.from(e),
    }));
    const { kernel: k, weighting } = fitRidge(cal, c.head, c.lambda, c.center);
    expect(weighting).toBe("head");
    const manual = solveRidge(
      cal.map((p) => ({
        e: p.meanEmbedding,
        x: p.target.x,
        y: p.target.y,
        w: calWeight(p.meanEmbedding, c.head),
      })),
      c.lambda,
      c.center,
    );
    expect(maxAbs(Array.from(k), Array.from(manual))).toBe(0);
  });
});

describe("ridge_fixture.json", () => {
  const p = join(WP1, "ridge_fixture.json");
  const run = existsSync(p) ? it : it.skip;
  run("matches the exporter's numpy kernel", () => {
    const f = JSON.parse(readFileSync(p, "utf8"));
    const lam: number = f.lambda ?? f.lambda_ridge ?? 1.0;
    const center: number = f.center ?? 0.5;
    const src = f.rows ?? f.cal_points;
    const r: RidgeRow[] = src.map((row: any) => ({
      e: Float32Array.from(row.e ?? row.embedding),
      x: row.x ?? row.target[0],
      y: row.y ?? row.target[1],
      w: row.w ?? row.weight,
    }));
    const k = solveRidge(r, lam, center);
    expect(maxAbs(Array.from(k), (f.kernel as any[]).flat())).toBeLessThan(1e-5);
  });
});
