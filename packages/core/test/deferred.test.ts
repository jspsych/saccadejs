import { runCalibration, runValidation } from "../src/calibration";
import {
  DeferredEmbedder,
  DeferredFrameDropped,
  EMBED_WORKER_SOURCE,
  chooseMode,
  predictSeries,
  recommendedWorkers,
} from "../src/deferred";
import type { WorkerLike } from "../src/deferred";
import type { TrackerFrame } from "../src/pipeline";
import { predict } from "../src/ridge";
import type { SaccadeTracker } from "../src/tracker";
import type { EmbedResult, Gaze } from "../src/types";

const CROP_LEN = 144 * 36;

/**
 * A worker stand-in that answers the pool's protocol. The "embedding" is the crop's first byte
 * and a constant, so a test can tell which crop a result came from. Replies are queued and sent
 * when the test calls `flush()`, so in-flight state can be inspected in between.
 */
class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  received: { id: number; first: number }[] = [];
  private outbox: unknown[] = [];

  constructor(private behaviour: { failBoot?: boolean; failEmbed?: boolean; dim?: number } = {}) {
    FakeWorker.all.push(this);
  }

  postMessage(message: { type: string; id?: number; crop?: ArrayBuffer }): void {
    if (message.type === "init") {
      const reply = this.behaviour.failBoot
        ? { type: "error", message: "out of memory" }
        : { type: "ready", dim: this.behaviour.dim ?? 2, emitsWeight: false };
      queueMicrotask(() => this.onmessage?.({ data: reply } as MessageEvent));
    } else if (message.type === "embed") {
      const first = new Uint8Array(message.crop as ArrayBuffer)[0];
      this.received.push({ id: message.id as number, first });
      this.outbox.push(
        this.behaviour.failEmbed
          ? { type: "error", id: message.id, message: "boom" }
          : {
              type: "result",
              id: message.id,
              embedding: new Float32Array([first, 1]).buffer,
              weight: null,
              ms: 100,
            },
      );
    }
  }

  /** Deliver every queued reply. */
  flush(): void {
    const out = this.outbox;
    this.outbox = [];
    for (const data of out) this.onmessage?.({ data } as MessageEvent);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function crop(first: number): Uint8Array {
  const c = new Uint8Array(CROP_LEN);
  c[0] = first;
  return c;
}

/** Let promise callbacks run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Keep flushing every fake worker until nothing is left to answer. */
async function flushAll(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    for (const w of FakeWorker.all) w.flush();
    await tick();
  }
}

function pool(workers: number, behaviour: ConstructorParameters<typeof FakeWorker>[0] = {}) {
  return new DeferredEmbedder({
    workers,
    modelBytes: new Uint8Array(8),
    createWorker: () => new FakeWorker(behaviour),
  });
}

beforeEach(() => {
  FakeWorker.all = [];
});

describe("DeferredEmbedder", () => {
  it("embeds every submitted crop and resolves each with its own result", async () => {
    const embedder = pool(2);
    await embedder.init();
    const jobs = [1, 2, 3, 4, 5].map((n) => embedder.submit(crop(n)));
    await flushAll();
    const results = await Promise.all(jobs);
    expect(results.map((r) => r.embedding[0])).toEqual([1, 2, 3, 4, 5]);
    expect(embedder.stats).toMatchObject({ workers: 2, embedded: 5, queued: 0, inFlight: 0 });
  });

  it("gives each worker one frame at a time, in submission order", async () => {
    const embedder = pool(2);
    await embedder.init();
    for (const n of [1, 2, 3]) void embedder.submit(crop(n));
    expect(FakeWorker.all.map((w) => w.received.map((r) => r.first))).toEqual([[1], [2]]);
    expect(embedder.pending).toBe(3);
    FakeWorker.all[0].flush();
    await tick();
    expect(FakeWorker.all[0].received.map((r) => r.first)).toEqual([1, 3]);
  });

  it("queues frames submitted before the workers are ready", async () => {
    const embedder = pool(1);
    const job = embedder.submit(crop(7));
    await embedder.init();
    await flushAll();
    expect((await job).embedding[0]).toBe(7);
  });

  it("copies the crop, so the caller may reuse its buffer", async () => {
    const embedder = pool(1);
    await embedder.init();
    const buffer = crop(9);
    const job = embedder.submit(buffer);
    buffer[0] = 0;
    await flushAll();
    expect((await job).embedding[0]).toBe(9);
  });

  it("keeps going when some workers fail to start, and fails only if none do", async () => {
    let n = 0;
    const embedder = new DeferredEmbedder({
      workers: 3,
      modelBytes: new Uint8Array(8),
      createWorker: () => new FakeWorker({ failBoot: n++ > 0 }),
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(embedder.init()).resolves.toEqual({ workers: 1, requested: 3 });
    warn.mockRestore();

    await expect(pool(2, { failBoot: true }).init()).rejects.toThrow("out of memory");
  });

  it("rejects a frame the worker fails on, and keeps serving the rest", async () => {
    const embedder = pool(1, { failEmbed: true });
    await embedder.init();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const job = embedder.submit(crop(1));
    const rejected = expect(job).rejects.toMatchObject({ reason: "failed" });
    await flushAll();
    await rejected;
    expect(embedder.stats.failed).toBe(1);
    error.mockRestore();
  });

  it("rejects frames past maxQueue instead of growing without bound", async () => {
    const embedder = new DeferredEmbedder({
      workers: 1,
      maxQueue: 2,
      modelBytes: new Uint8Array(8),
      createWorker: () => new FakeWorker(),
    });
    // Not started yet, so nothing leaves the queue.
    void embedder.submit(crop(1)).catch(() => undefined);
    void embedder.submit(crop(2)).catch(() => undefined);
    await expect(embedder.submit(crop(3))).rejects.toBeInstanceOf(DeferredFrameDropped);
    expect(embedder.stats.dropped).toBe(1);
  });

  it("cancels what is still queued but lets in-flight frames finish", async () => {
    const embedder = pool(1);
    await embedder.init();
    const first = embedder.submit(crop(1));
    const second = embedder.submit(crop(2));
    expect(embedder.cancel()).toBe(1);
    await expect(second).rejects.toMatchObject({ reason: "cancelled" });
    await flushAll();
    expect((await first).embedding[0]).toBe(1);
  });

  it("drains to empty, or reports what is left at the deadline", async () => {
    const embedder = pool(1);
    await embedder.init();
    void embedder.submit(crop(1));
    const stalled = await embedder.drain({ deadlineMs: 0 });
    expect(stalled).toEqual({ left: 1, timedOut: true });

    const draining = embedder.drain({ deadlineMs: 5000 });
    await flushAll();
    await expect(draining).resolves.toEqual({ left: 0, timedOut: false });
  });

  it("measures a round across the whole pool", async () => {
    const embedder = pool(2);
    const measuring = embedder.measure(1);
    await flushAll();
    const { latencyMs, perFrameMs } = await measuring;
    expect(perFrameMs).toBeCloseTo(latencyMs / 2);
  });

  it("rejects everything pending and stops the workers on dispose", async () => {
    const embedder = pool(1);
    await embedder.init();
    const job = embedder.submit(crop(1));
    embedder.dispose();
    await expect(job).rejects.toMatchObject({ reason: "disposed" });
    expect(FakeWorker.all[0].terminated).toBe(true);
    await expect(embedder.submit(crop(2))).rejects.toMatchObject({ reason: "disposed" });
  });

  it("ships a worker whose source parses", () => {
    // The worker runs as a module, where top-level syntax errors would only show up in a real
    // browser. Parsing it as a function body catches them here.
    expect(() => new Function(EMBED_WORKER_SOURCE.replace(/await import\(/g, "("))).not.toThrow();
  });
});

describe("recommendedWorkers", () => {
  it("leaves two cores free and caps the pool at three", () => {
    expect(recommendedWorkers({ hardwareConcurrency: 4 })).toBe(2);
    expect(recommendedWorkers({ hardwareConcurrency: 16, deviceMemory: 8 })).toBe(3);
  });

  it("uses one worker on 4 GB or less, and never fewer than one", () => {
    expect(recommendedWorkers({ hardwareConcurrency: 8, deviceMemory: 4 })).toBe(1);
    expect(recommendedWorkers({ hardwareConcurrency: 2 })).toBe(1);
    expect(recommendedWorkers({})).toBe(1);
  });
});

describe("chooseMode", () => {
  it("defers every machine without WebGPU, however fast", () => {
    expect(chooseMode({ ep: "wasm", embedMs: 5, cameraFps: 30 })).toMatchObject({
      mode: "deferred",
      reason: "no WebGPU",
    });
  });

  it("runs live when an encode fits in 85% of a camera frame", () => {
    // 15 fps: 85% of 66.7 ms is 56.7 ms.
    expect(chooseMode({ ep: "webgpu", embedMs: 50, cameraFps: 15 }).mode).toBe("live");
    expect(chooseMode({ ep: "webgpu", embedMs: 60, cameraFps: 15 })).toMatchObject({
      mode: "deferred",
      reason: "too slow",
    });
  });

  it("holds the limit between 30 and 80 ms, and at 30 when the camera rate is unknown", () => {
    expect(chooseMode({ ep: "webgpu", embedMs: 1, cameraFps: 60 }).limitMs).toBe(30);
    expect(chooseMode({ ep: "webgpu", embedMs: 1, cameraFps: 5 }).limitMs).toBe(80);
    expect(chooseMode({ ep: "webgpu", embedMs: 1, cameraFps: null }).limitMs).toBe(30);
  });
});

describe("predictSeries", () => {
  const kernel = new Float32Array([1, 0, 0, 1]); // x = e[0], y = e[1]

  it("predicts each frame on its own at smoothing 1", () => {
    const frames = [
      { embedding: new Float32Array([0.1, 0.2]), weight: null, time: 10 },
      { embedding: new Float32Array([0.3, 0.4]), weight: null, time: 20 },
    ];
    const out = predictSeries(frames, kernel, 1, 0);
    expect(out.map((s) => s.time)).toEqual([10, 20]);
    expect(out[1].gaze).toEqual(predict(frames[1].embedding, kernel, 0));
  });

  it("averages a window and times it by the window's mean capture", () => {
    const frames = [
      { embedding: new Float32Array([0, 0]), weight: null, time: 10 },
      { embedding: new Float32Array([1, 1]), weight: null, time: 20 },
      { embedding: new Float32Array([2, 2]), weight: null, time: 30 },
    ];
    const out = predictSeries(frames, kernel, 2, 0);
    expect(out[2].time).toBe(25);
    expect(out[2].gaze.x).toBeCloseTo(1.5);
    expect(out[0].time).toBe(10);
  });
});

/**
 * A tracker in deferred mode: frames carry a crop and no embedding, and `embedDeferred` answers
 * through a promise the test resolves, as the worker pool would.
 */
function deferredTracker() {
  let n = 0;
  const owed: { first: number; resolve: (r: EmbedResult) => void }[] = [];
  const points: { target: Gaze; embeddings: Float32Array[] }[] = [];
  const frame = (): TrackerFrame => {
    n++;
    return {
      gaze: null,
      faceFound: true,
      crop: crop(n % 256),
      embedding: null,
      weight: null,
      quality: null,
      meanEmbedding: null,
      timings: { landmark: 0, crop: 0, embed: 0, total: 0 },
      time: {
        capture: n,
        source: "captureTime",
        receive: null,
        presentedFrames: n,
        dropped: 0,
        callback: n,
        emit: n,
        meanCapture: null,
      },
      fps: 30,
      error: null,
    };
  };
  const tracker = {
    mode: "deferred",
    nextFrame: async () => {
      await tick();
      return frame();
    },
    embedDeferred: (c: Uint8Array) =>
      new Promise<EmbedResult>((resolve) => owed.push({ first: c[0], resolve })),
    getKernel: () => new Float32Array([1, 0, 0, 1]),
    getCenter: () => 0,
    getSmoothingFrames: () => 1,
    addCalibrationPoint: (target: Gaze, embeddings: Float32Array[]) =>
      points.push({ target, embeddings }),
    getCalibrationPoints: () => points,
  } as unknown as SaccadeTracker;
  /** Answer every queued frame with an embedding that maps to `gaze`. */
  const answer = (gaze: Gaze) => {
    for (const o of owed.splice(0)) {
      o.resolve({ embedding: new Float32Array([gaze.x, gaze.y]), weight: null });
    }
  };
  return { tracker, owed, points, answer };
}

describe("drivers in deferred mode", () => {
  it("runCalibration queues the frames and adds the points once they are embedded", async () => {
    const { tracker, owed, points, answer } = deferredTracker();
    const progress: [number, number][] = [];
    const run = runCalibration(
      tracker,
      [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.8 },
      ],
      { settleMs: 0, captureMs: 20 },
      { showTarget: () => undefined, processing: (done, total) => progress.push([done, total]) },
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(owed.length).toBeGreaterThan(0);
    expect(points).toHaveLength(0);
    answer({ x: 0.5, y: 0.5 });
    const out = await run;
    expect(out).toHaveLength(2);
    expect(points.map((p) => p.target)).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.8 },
    ]);
    const [done, total] = progress[progress.length - 1];
    expect(done).toBe(total);
  });

  it("runValidation scores the gaze computed from the embedded frames", async () => {
    const { tracker, answer } = deferredTracker();
    const run = runValidation(
      tracker,
      [{ x: 0.5, y: 0.5 }],
      {
        settleMs: 0,
        captureMs: 20,
        roiRadiusPx: 10,
        viewport: { width: 1000, height: 1000 },
      },
      { showTarget: () => undefined },
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    answer({ x: 0.5, y: 0.6 });
    const result = await run;
    expect(result.points[0].samples.length).toBeGreaterThan(0);
    expect(result.points[0].errorPx).toBeCloseTo(100);
  });
});
