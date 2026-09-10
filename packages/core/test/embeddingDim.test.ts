import { presetModules, resetModules } from "../src/assets";
import { fitRidge, meanEmbedding } from "../src/grids";
import { OrtEmbeddingModel } from "../src/model";
import { calWeight, predict, solveRidge } from "../src/ridge";
import { SaccadeTracker } from "../src/tracker";
import type { CalPoint, RidgeRow } from "../src/types";

// ---------------------------------------------------------------------------- doubles

/**
 * An onnxruntime-web stand-in whose session emits an embedding of `dim`, plus whatever extra
 * outputs the case needs. Enough to exercise output binding and the warm-up checks; the real
 * runtime is covered elsewhere.
 */
function fakeOrt(opts: {
  dim: number | (() => number);
  outputs?: Record<string, number[]>;
  outputNames?: string[];
}) {
  const dim = (): number => (typeof opts.dim === "function" ? opts.dim() : opts.dim);
  const extra = opts.outputs ?? {};
  return {
    env: { wasm: {} as Record<string, unknown> },
    Tensor: class {
      constructor(
        public type: string,
        public data: Float32Array,
        public dims: number[],
      ) {}
    },
    InferenceSession: {
      create: async () => ({
        inputNames: ["eye_image"],
        outputNames: opts.outputNames ?? ["embedding", ...Object.keys(extra)],
        run: async () => {
          const out: Record<string, { data: Float32Array }> = {
            embedding: { data: new Float32Array(dim()) },
          };
          for (const [k, v] of Object.entries(extra)) out[k] = { data: Float32Array.from(v) };
          return out;
        },
        release: () => undefined,
      }),
    },
  } as never;
}

function loadModel(ort: never): OrtEmbeddingModel {
  resetModules();
  presetModules(ort);
  global.fetch = jest.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        body: null,
        arrayBuffer: async () => new Uint8Array(8).buffer,
      }) as unknown as Response,
  ) as never;
  return new OrtEmbeddingModel({ assets: { modelUrl: "/m.onnx" }, executionProviders: ["wasm"] });
}

const point = (target: { x: number; y: number }, e: number[], weights?: number[]): CalPoint => ({
  target,
  embeddings: [Float32Array.from(e)],
  weights: weights ?? null,
  meanEmbedding: Float32Array.from(e),
});

afterEach(() => resetModules());

// ---------------------------------------------------------------------------- the solver

describe("solveRidge at other embedding widths", () => {
  /**
   * `d` rows of a diagonally dominant (so well-conditioned, but not diagonal) design. With as
   * many rows as features and a negligible penalty the fit should very nearly interpolate its
   * targets -- which is only true if the whole solve runs at the right width.
   */
  const reproduces = (d: number): number => {
    const rows: RidgeRow[] = [];
    for (let i = 0; i < d; i++) {
      const e = new Float32Array(d);
      for (let j = 0; j < d; j++) e[j] = (i === j ? 1 : 0) + 0.05 * Math.sin((i + 1) * (j + 1));
      rows.push({ e, x: 0.1 + (i % 7) * 0.12, y: 0.9 - (i % 5) * 0.15, w: 1 });
    }
    const k = solveRidge(rows, 1e-6, 0.5);
    expect(k).toHaveLength(d * 2);
    let worst = 0;
    for (const r of rows) {
      const p = predict(r.e, k, 0.5);
      worst = Math.max(worst, Math.abs(p.x - r.x), Math.abs(p.y - r.y));
    }
    return worst;
  };

  it("solves an 8-d problem", () => expect(reproduces(8)).toBeLessThan(0.05));
  it("solves a 192-d problem", () => expect(reproduces(192)).toBeLessThan(0.05));

  it("refuses rows of differing width rather than mixing them", () => {
    const rows: RidgeRow[] = [
      { e: new Float32Array(8), x: 0.5, y: 0.5, w: 1 },
      { e: new Float32Array(16), x: 0.5, y: 0.5, w: 1 },
    ];
    expect(() => solveRidge(rows, 1, 0.5)).toThrow(/lengths differ/);
  });

  it("refuses an empty fit, which has no width to infer", () => {
    expect(() => solveRidge([], 1, 0.5)).toThrow(/no calibration rows/);
  });
});

// ---------------------------------------------------------------------------- the head

describe("calWeight against a foreign embedding", () => {
  it("throws instead of returning NaN", () => {
    const head = { kernel: new Array(128).fill(0.1), bias: 0 };
    // Before the length check this read past the end of `kernel`, produced NaN, and turned
    // every coefficient of the fit into NaN without an error anywhere.
    expect(() => calWeight(new Float32Array(64), head)).toThrow(/expects a 128-d embedding/);
  });
});

// ---------------------------------------------------------------------------- the mean

describe("meanEmbedding", () => {
  it("takes its width from the embeddings", () => {
    expect(meanEmbedding([new Float32Array(7), new Float32Array(7)])).toHaveLength(7);
  });

  it("weights frames before averaging them", () => {
    const a = Float32Array.from([0, 10]);
    const b = Float32Array.from([10, 0]);
    const mean = meanEmbedding([a, b], [0.75, 0.25]);
    expect(mean[0]).toBeCloseTo(2.5, 6);
    expect(mean[1]).toBeCloseTo(7.5, 6);
  });

  it("falls back to the plain mean when every frame is distrusted", () => {
    const a = Float32Array.from([0, 10]);
    const b = Float32Array.from([10, 0]);
    const mean = meanEmbedding([a, b], [0, 0]);
    expect(mean[0]).toBeCloseTo(5, 6);
    expect(mean[1]).toBeCloseTo(5, 6);
  });

  it("refuses a weight list that does not match the frames", () => {
    const a = Float32Array.from([0, 10]);
    const b = Float32Array.from([10, 0]);
    expect(() => meanEmbedding([a, b], [0.75])).toThrow(/1 weights for 2 embeddings/);
  });

  it("refuses embeddings of differing width", () => {
    expect(() => meanEmbedding([new Float32Array(4), new Float32Array(5)])).toThrow(
      /lengths differ/,
    );
  });
});

// ---------------------------------------------------------------------------- precedence

describe("fitRidge row weighting", () => {
  const cal = [
    point({ x: 0.2, y: 0.2 }, [1, 0, 0.5]),
    point({ x: 0.8, y: 0.3 }, [0, 1, 0.25]),
    point({ x: 0.5, y: 0.9 }, [0.5, 0.5, 1]),
  ];

  it("is uniform by default, and says so", () => {
    const { kernel, weighting } = fitRidge(cal, null, 1, 0.5);
    expect(weighting).toBe("uniform");
    expect(kernel).toHaveLength(6);
    // Uniform is plain unweighted ridge, not a special case: every row at w = 1.
    const manual = solveRidge(
      cal.map((p) => ({ e: p.meanEmbedding, x: p.target.x, y: p.target.y, w: 1 })),
      1,
      0.5,
    );
    expect(Array.from(kernel)).toEqual(Array.from(manual));
  });

  it("uses the model's per-frame weights when it emits them", () => {
    const weighted = cal.map((p, i) => ({ ...p, weights: [0.25 * (i + 1)] }));
    const { kernel, weighting } = fitRidge(weighted, null, 1, 0.5);
    expect(weighting).toBe("model");
    const manual = solveRidge(
      weighted.map((p, i) => ({
        e: p.meanEmbedding,
        x: p.target.x,
        y: p.target.y,
        w: 0.25 * (i + 1),
      })),
      1,
      0.5,
    );
    expect(Array.from(kernel)).toEqual(Array.from(manual));
  });

  it("refuses a half-weighted set rather than trusting the unweighted points most", () => {
    const mixed = [{ ...cal[0], weights: [0.5] }, cal[1], cal[2]];
    expect(() => fitRidge(mixed, null, 1, 0.5)).toThrow(/Weight every point or none/);
  });

  it("lets an explicit head override the model's weights", () => {
    const weighted = cal.map((p) => ({ ...p, weights: [0.5] }));
    const head = { kernel: [0.2, -0.1, 0.4], bias: 0.05 };
    const { kernel, weighting } = fitRidge(weighted, head, 1, 0.5);
    expect(weighting).toBe("head");
    const manual = solveRidge(
      weighted.map((p) => ({
        e: p.meanEmbedding,
        x: p.target.x,
        y: p.target.y,
        w: calWeight(p.meanEmbedding, head),
      })),
      1,
      0.5,
    );
    expect(Array.from(kernel)).toEqual(Array.from(manual));
  });
});

// ---------------------------------------------------------------------------- the model

describe("OrtEmbeddingModel output handling", () => {
  it("takes its embedding width from the model, not from EMB_DIM", async () => {
    const m = loadModel(fakeOrt({ dim: 64 }));
    await m.init();
    expect(m.embeddingDim).toBe(64);
    expect(m.identity().dim).toBe(64);
    expect((await m.embed(new Uint8Array(36 * 144))).embedding).toHaveLength(64);
  });

  it("reads a per-frame weight from a named second output", async () => {
    const m = loadModel(fakeOrt({ dim: 32, outputs: { cal_weight: [0.75] } }));
    await m.init();
    expect(m.identity().emitsWeight).toBe(true);
    expect((await m.embed(new Uint8Array(36 * 144))).weight).toBeCloseTo(0.75, 6);
  });

  it("recognises an unnamed scalar second output", async () => {
    const m = loadModel(fakeOrt({ dim: 32, outputs: { aux_0: [0.5] } }));
    await m.init();
    expect(m.identity().emitsWeight).toBe(true);
    expect((await m.embed(new Uint8Array(36 * 144))).weight).toBeCloseTo(0.5, 6);
  });

  it("leaves an ambiguous extra output alone rather than guessing", async () => {
    const m = loadModel(fakeOrt({ dim: 32, outputs: { aux_0: [0.5], aux_1: [0.25] } }));
    await m.init();
    expect(m.identity().emitsWeight).toBe(false);
    expect((await m.embed(new Uint8Array(36 * 144))).weight).toBeNull();
  });

  it("reports no weight for a model with only an embedding", async () => {
    const m = loadModel(fakeOrt({ dim: 32 }));
    await m.init();
    expect(m.identity().emitsWeight).toBe(false);
    expect((await m.embed(new Uint8Array(36 * 144))).weight).toBeNull();
  });

  it("fails at load when the weight output is not a probability", async () => {
    // The warm-up inference is what catches this, so a model that emits nonsense never
    // reaches a participant.
    const m = loadModel(fakeOrt({ dim: 32, outputs: { cal_weight: [4.2] } }));
    await expect(m.init()).rejects.toThrow(/must be a finite number in \[0, 1\]/);
  });

  it("fails when the embedding width moves partway through a session", async () => {
    let n = 0;
    const m = loadModel(fakeOrt({ dim: () => (n++ === 0 ? 32 : 48) }));
    await m.init();
    await expect(m.embed(new Uint8Array(36 * 144))).rejects.toThrow(/must be stable/);
  });
});

// ---------------------------------------------------------------------------- the tracker

describe("SaccadeTracker calibration weighting", () => {
  const grid = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.5, y: 0.8 },
  ];
  const emb = (i: number): Float32Array => Float32Array.from([i, 1 - i, 0.5]);

  it("fits unweighted, at the model's width, and reports it", () => {
    const t = new SaccadeTracker();
    grid.forEach((target, i) => t.addCalibrationPoint(target, [emb(i / 3), emb(i / 3 + 0.1)]));
    const fit = t.fitCalibration();
    expect(fit).toEqual({ lambda: 3, nPoints: 3, weighting: "uniform" });
    expect(t.getKernel()).toHaveLength(6);
    expect(t.getCalWeighting()).toBe("uniform");
  });

  it("carries per-frame weights into the point's mean and its row weight", () => {
    const t = new SaccadeTracker();
    t.addCalibrationPoint({ x: 0.5, y: 0.5 }, [emb(0), emb(1)], [0.75, 0.25]);
    const p = t.getCalibrationPoints()[0];
    expect(p.weights).toEqual([0.75, 0.25]);
    // The mean is weighted, not plain: 0.75 * 0 + 0.25 * 1.
    expect(p.meanEmbedding[0]).toBeCloseTo(0.25, 6);
    grid.slice(1).forEach((target, i) => t.addCalibrationPoint(target, [emb(i)], [0.5]));
    expect(t.fitCalibration()!.weighting).toBe("model");
  });

  it("uses a head when one is supplied, over the model's own weights", () => {
    const head = { kernel: [0.2, -0.1, 0.4], bias: 0.05 };
    const t = new SaccadeTracker({ calHead: head });
    grid.forEach((target, i) => t.addCalibrationPoint(target, [emb(i / 3)], [0.5]));
    expect(t.fitCalibration()!.weighting).toBe("head");
  });

  it("clears the recorded weighting along with the fit", () => {
    const t = new SaccadeTracker();
    grid.forEach((target, i) => t.addCalibrationPoint(target, [emb(i / 3)]));
    t.fitCalibration();
    t.clearCalibration();
    expect(t.getCalWeighting()).toBeNull();
  });
});
