// Deferred mode: eye embedding on background threads, for machines too slow to run the model
// live.
//
// On a machine with a capable GPU the encoder costs about 20 ms and runs inside the frame loop.
// Without WebGPU, ONNX Runtime falls back to single-threaded wasm, and the same call costs one
// to several hundred milliseconds: longer than the 33-67 ms between camera frames. Run inline,
// that stalls the frame loop, so MediaPipe misses frames and the page stops responding.
//
// So on those machines the encoder moves to a pool of workers. The main thread keeps the part
// that must happen live (camera readback, face landmarks, the eye crop) and posts crops over;
// the workers answer when they can, and nothing on the page waits for them. Gaze arrives late,
// which rules out anything gaze-contingent, and the queue has to be allowed to catch up at some
// point (between blocks, or at the end) before the data is complete.
//
// This is a port of the pool the saccade.js validation study ran on its slow machines.

import type { SaccadeAssets } from "./assets";
import { fetchModelBytes, modelUrl, ortWasmUrl } from "./assets";
import { CENTER, meanEmbedding } from "./grids";
import { predict } from "./ridge";
import type { EmbedResult, Gaze } from "./types";
import { EYE_H, EYE_W } from "./types";

const CROP_LEN = EYE_W * EYE_H;

/**
 * The worker, as source. A string rather than a separate file so that the pool works from a
 * bundler build, from the `<script>` build and from a CDN alike, with nothing extra to host: it
 * is started from a `blob:` URL. A page whose Content-Security-Policy forbids `blob:` workers
 * can host this text itself and pass `createWorker`.
 *
 * Protocol:
 *   -> {type: "init", ortUrl, wasmDir, model: ArrayBuffer}  <- {type: "ready", ...} | {type: "error"}
 *   -> {type: "embed", id, crop: ArrayBuffer}               <- {type: "result", id, embedding, weight, ms}
 *
 * Its preprocessing and output handling are `OrtEmbeddingModel`'s: the raw 0-255 crop widened to
 * float32, the embedding from the first output, and a per-frame weight from a second output
 * named like one. Change one, change both.
 */
export const EMBED_WORKER_SOURCE = `
const EYE_W = ${EYE_W};
const EYE_H = ${EYE_H};
const CROP_LEN = EYE_W * EYE_H;
const WEIGHT_NAMES = new Set(["cal_weight", "weight", "quality"]);
let session = null;
let inputName = "eye_image";
let outputName = "embedding";
let weightName = null;
let inputData = null;
let inputTensor = null;
let dim = null;

async function init(message) {
  const ort = await import(message.ortUrl);
  ort.env.wasm.wasmPaths = message.wasmDir;
  // One thread per worker: the pool is the parallelism. Frames are independent, so throughput
  // scales with workers where splitting one small model's encode across threads did not.
  ort.env.wasm.numThreads = 1;
  session = await ort.InferenceSession.create(new Uint8Array(message.model), {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  if (!session.inputNames.includes(inputName)) inputName = session.inputNames[0];
  if (!session.outputNames.includes(outputName)) outputName = session.outputNames[0];
  weightName = session.outputNames.find((n) => n !== outputName && WEIGHT_NAMES.has(n)) ?? null;
  inputData = new Float32Array(CROP_LEN);
  inputTensor = new ort.Tensor("float32", inputData, [1, EYE_H, EYE_W, 1]);
  // One real inference before anything is timed: the first run pays for wasm compilation.
  const warm = await run(new Uint8Array(CROP_LEN));
  return { type: "ready", dim: warm.embedding.length, emitsWeight: weightName != null };
}

async function run(crop) {
  if (crop.length !== CROP_LEN) throw new Error("crop length " + crop.length + " != " + CROP_LEN);
  for (let i = 0; i < CROP_LEN; i++) inputData[i] = crop[i];
  const out = await session.run({ [inputName]: inputTensor });
  const embedding = Float32Array.from(out[outputName].data);
  if (embedding.length === 0) throw new Error("model produced an empty embedding");
  if (dim == null) dim = embedding.length;
  else if (embedding.length !== dim) throw new Error("embedding length changed");
  let weight = null;
  if (weightName) {
    const w = out[weightName].data[0];
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 1) {
      throw new Error("model output " + weightName + " is " + w + "; it must be in [0, 1]");
    }
    weight = w;
  }
  return { embedding, weight };
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      self.postMessage(await init(message));
    } else if (message.type === "embed") {
      if (!session) throw new Error("the worker has not been initialized");
      const started = performance.now();
      const { embedding, weight } = await run(new Uint8Array(message.crop));
      self.postMessage(
        { type: "result", id: message.id, embedding: embedding.buffer, weight, ms: performance.now() - started },
        [embedding.buffer],
      );
    }
  } catch (error) {
    self.postMessage({ type: "error", id: message && message.id, message: String((error && error.message) || error) });
  }
};
`;

/** The part of `Worker` the pool uses, so tests can hand in a fake. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface DeferredEmbedderOptions {
  /** Where the model and onnxruntime-web come from; the same `assets` the tracker was given. */
  assets?: SaccadeAssets;
  /** How many workers to start. Default `recommendedWorkers()`. */
  workers?: number;
  /**
   * The most frames that may wait in the queue. Each holds a 5 KB eye crop, so the default of
   * 10000 is about 50 MB. A frame submitted past it is rejected rather than queued.
   */
  maxQueue?: number;
  /** The model's bytes, when the caller already has them. Default: fetched from `assets`. */
  modelBytes?: Uint8Array;
  /** Start one worker. Default: a module worker running `EMBED_WORKER_SOURCE` from a blob. */
  createWorker?: () => WorkerLike;
}

/** Why a submitted frame was never embedded. */
export class DeferredFrameDropped extends Error {
  constructor(
    readonly reason: "queue-full" | "cancelled" | "disposed" | "failed",
    message?: string,
  ) {
    super(message ?? `frame not embedded: ${reason}`);
    this.name = "DeferredFrameDropped";
  }
}

export interface DeferredStats {
  /** Workers running. */
  workers: number;
  /** Frames waiting for a worker. */
  queued: number;
  /** Frames a worker is embedding now. */
  inFlight: number;
  /** Frames embedded so far. */
  embedded: number;
  /** Frames a worker failed on. */
  failed: number;
  /** Frames rejected because the queue was full, or cancelled before a worker reached them. */
  dropped: number;
}

export interface DrainResult {
  /** Frames still queued or in flight when the drain ended. */
  left: number;
  timedOut: boolean;
}

/** Most workers the pool starts by default: the validation study ran up to three. */
export const MAX_DEFAULT_WORKERS = 3;

/**
 * How many workers this machine can spare, each single-threaded and holding its own copy of the
 * model and ONNX Runtime.
 *
 * The cores minus two, so the page, the camera and MediaPipe keep theirs, and at most
 * `MAX_DEFAULT_WORKERS`. In piloting for the validation study, machines with 4 GB of memory or
 * less could not handle more than one. `navigator.deviceMemory` exists only in Chromium, and is
 * rounded and capped at 8; elsewhere the cores alone decide.
 */
export function recommendedWorkers(
  nav:
    { hardwareConcurrency?: number; deviceMemory?: number } | undefined = globalThis.navigator as
    { hardwareConcurrency?: number; deviceMemory?: number } | undefined,
): number {
  const cores = nav?.hardwareConcurrency || 2;
  const memory = nav?.deviceMemory;
  const byMemory = memory != null && memory <= 4 ? 1 : Infinity;
  return Math.max(1, Math.min(MAX_DEFAULT_WORKERS, cores - 2, byMemory));
}

interface Slot {
  worker: WorkerLike;
  inflight: number | null;
}

interface Job {
  id: number;
  crop: Uint8Array;
  resolve: (r: EmbedResult) => void;
  reject: (e: Error) => void;
}

interface BootReply {
  dim: number;
  emitsWeight: boolean;
}

function defaultCreateWorker(): WorkerLike {
  const blob = new Blob([EMBED_WORKER_SOURCE], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url, { type: "module" });
  // The worker has read its script by the time it answers anything, but revoking straight away
  // races the fetch in some browsers. Revoking on the first message is late enough.
  const revoke = (): void => URL.revokeObjectURL(url);
  worker.addEventListener("message", revoke, { once: true });
  worker.addEventListener("error", revoke, { once: true });
  return worker as unknown as WorkerLike;
}

/**
 * A pool of workers that embed eye crops off the main thread.
 *
 * Every worker is single-threaded with its own copy of the model, and each embeds a different
 * frame. That needs no cross-origin isolation, so it works on any host. The cost is memory:
 * every worker holds the model and ONNX Runtime.
 *
 * `submit()` returns a promise per frame. Frames are embedded in the order they were submitted.
 */
export class DeferredEmbedder {
  private opts: DeferredEmbedderOptions;
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private jobs = new Map<number, Job>();
  private nextId = 1;
  private ready: Promise<{ workers: number; requested: number }> | null = null;
  private disposed = false;
  private counts = { embedded: 0, failed: 0, dropped: 0 };
  private maxQueue: number;
  private loggedFailure = false;
  /** Running estimate of one encode on one worker, in ms. */
  private latency: number | null = null;
  /** Embedding length and weight output the workers reported. */
  info: BootReply | null = null;

  constructor(opts: DeferredEmbedderOptions = {}) {
    this.opts = opts;
    this.maxQueue = opts.maxQueue ?? 10000;
  }

  /**
   * Start the pool. Resolves once at least one worker is ready; a worker that fails to start
   * (out of memory, say) is dropped rather than failing the pool. Rejects only if none start.
   */
  init(): Promise<{ workers: number; requested: number }> {
    if (!this.ready) {
      this.ready = this.boot();
      this.ready.catch(() => {
        this.ready = null;
      });
    }
    return this.ready;
  }

  private async boot(): Promise<{ workers: number; requested: number }> {
    if (this.disposed) throw new Error("deferred embedder disposed");
    const requested = Math.max(1, Math.round(this.opts.workers ?? recommendedWorkers()));
    const assets = this.opts.assets ?? {};
    const model =
      this.opts.modelBytes ?? (await fetchModelBytes(new URL(modelUrl(assets), baseUrl()).href));
    const wasmDir = new URL(ortWasmUrl(assets), baseUrl()).href;
    const ortUrl = new URL(assets.ortModuleUrl ?? `${wasmDir}ort.bundle.min.mjs`, baseUrl()).href;

    const boots: Promise<Slot>[] = [];
    for (let i = 0; i < requested; i++) boots.push(this.startWorker(model, ortUrl, wasmDir));
    const outcomes = await Promise.allSettled(boots);
    const started = outcomes.filter(
      (o): o is PromiseFulfilledResult<Slot> => o.status === "fulfilled",
    );
    const failures = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    if (this.disposed) {
      for (const o of started) o.value.worker.terminate();
      throw new Error("deferred embedder disposed");
    }
    if (started.length === 0) throw failures[0].reason;
    if (failures.length) {
      console.warn(`saccade.js: ${failures.length} of ${requested} embed workers did not start`);
    }
    this.slots = started.map((o) => o.value);
    for (const slot of this.slots) slot.worker.onmessage = (e) => this.handle(slot, e.data);
    this.pump();
    return { workers: this.slots.length, requested };
  }

  private startWorker(model: Uint8Array, ortUrl: string, wasmDir: string): Promise<Slot> {
    return new Promise((resolve, reject) => {
      let worker: WorkerLike;
      try {
        worker = (this.opts.createWorker ?? defaultCreateWorker)();
      } catch (err) {
        reject(err);
        return;
      }
      const slot: Slot = { worker, inflight: null };
      const fail = (err: Error): void => {
        worker.terminate();
        reject(err);
      };
      worker.onmessage = (event) => {
        const message = event.data as { type: string; message?: string } & BootReply;
        if (message.type === "ready") {
          this.info = this.info ?? { dim: message.dim, emitsWeight: message.emitsWeight };
          resolve(slot);
        } else if (message.type === "error") {
          fail(new Error(message.message ?? "the embed worker failed to start"));
        }
      };
      worker.onerror = (event) => fail(new Error(event?.message || "the embed worker failed"));
      // A copy each, transferred: every worker needs its own, and a transfer avoids a second.
      const copy = model.slice();
      worker.postMessage({ type: "init", ortUrl, wasmDir, model: copy.buffer }, [copy.buffer]);
    });
  }

  /** Workers running. 0 before `init()` resolves. */
  get workers(): number {
    return this.slots.length;
  }

  /** Frames queued or in flight. */
  get pending(): number {
    return this.queue.length + this.slots.filter((s) => s.inflight != null).length;
  }

  get stats(): DeferredStats {
    const inFlight = this.slots.filter((s) => s.inflight != null).length;
    return { workers: this.slots.length, queued: this.queue.length, inFlight, ...this.counts };
  }

  /** Recent time for one encode on one worker, in ms; null before any has finished. */
  get latencyMs(): number | null {
    return this.latency;
  }

  /** Frames the whole pool can embed per second, at the recent latency; null before any. */
  get throughput(): number | null {
    return this.latency && this.slots.length ? (1000 * this.slots.length) / this.latency : null;
  }

  /**
   * Queue one crop. Resolves with its embedding once a worker has run it; rejects with a
   * `DeferredFrameDropped` if it never will be (the queue was full, it was cancelled, the
   * worker failed on it, or the pool was disposed). The crop is copied, so the caller may keep
   * or reuse its own.
   */
  submit(crop: Uint8Array): Promise<EmbedResult> {
    if (this.disposed) return Promise.reject(new DeferredFrameDropped("disposed"));
    if (crop.length !== CROP_LEN) {
      return Promise.reject(new Error(`crop length ${crop.length} != ${CROP_LEN}`));
    }
    if (this.queue.length >= this.maxQueue) {
      this.counts.dropped++;
      return Promise.reject(new DeferredFrameDropped("queue-full"));
    }
    return new Promise<EmbedResult>((resolve, reject) => {
      const job: Job = { id: this.nextId++, crop: new Uint8Array(crop), resolve, reject };
      this.jobs.set(job.id, job);
      this.queue.push(job);
      this.pump();
    });
  }

  /**
   * Time one round of encodes across the whole pool, so a caller can budget from this machine
   * rather than from an assumption about it. The workers have each run one inference while
   * starting, so wasm compilation is not in these numbers. Waits behind anything queued.
   *
   * @returns ms for one encode on one worker (the median round), and ms per frame for the pool.
   */
  async measure(rounds = 3): Promise<{ latencyMs: number; perFrameMs: number }> {
    await this.init();
    const crop = new Uint8Array(CROP_LEN);
    for (let i = 0; i < CROP_LEN; i++) crop[i] = (i * 37) % 256;
    const times: number[] = [];
    for (let r = 0; r < rounds; r++) {
      const started = performance.now();
      await Promise.all(this.slots.map(() => this.submit(crop)));
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    const latencyMs = times[Math.floor(times.length / 2)];
    this.latency = latencyMs;
    return { latencyMs, perFrameMs: latencyMs / this.slots.length };
  }

  /**
   * Wait for the queue to empty, or for `deadlineMs` to pass. Nothing is cancelled when the
   * deadline passes: whatever is left keeps going, and the caller can `cancel()` it.
   */
  drain(
    opts: { deadlineMs?: number | null; onProgress?: (left: number, total: number) => void } = {},
  ): Promise<DrainResult> {
    const started = performance.now();
    const total = this.pending;
    const deadline = opts.deadlineMs;
    return new Promise((resolve) => {
      const tick = (): void => {
        const left = this.pending;
        opts.onProgress?.(left, total);
        if (left === 0) return resolve({ left: 0, timedOut: false });
        if (
          deadline != null &&
          Number.isFinite(deadline) &&
          performance.now() - started >= deadline
        ) {
          return resolve({ left, timedOut: true });
        }
        setTimeout(tick, 100);
      };
      this.pump();
      tick();
    });
  }

  /**
   * Give up on every frame still waiting for a worker; each one's promise rejects with
   * `DeferredFrameDropped("cancelled")`. Frames already in flight are allowed to finish.
   *
   * @returns How many frames were cancelled.
   */
  cancel(): number {
    const cancelled = this.queue;
    this.queue = [];
    for (const job of cancelled) {
      this.jobs.delete(job.id);
      job.reject(new DeferredFrameDropped("cancelled"));
    }
    this.counts.dropped += cancelled.length;
    return cancelled.length;
  }

  /** Stop every worker. Pending frames reject with `DeferredFrameDropped("disposed")`. */
  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
    for (const job of this.jobs.values()) job.reject(new DeferredFrameDropped("disposed"));
    this.jobs.clear();
    this.queue = [];
  }

  /** One encode per worker at a time: each holds one session and one input tensor. */
  private pump(): void {
    for (const slot of this.slots) {
      if (slot.inflight != null) continue;
      const job = this.queue.shift();
      if (!job) return;
      slot.inflight = job.id;
      // A copy is transferred, so the job keeps its crop until the result is back.
      const transfer = job.crop.slice();
      slot.worker.postMessage({ type: "embed", id: job.id, crop: transfer.buffer }, [
        transfer.buffer,
      ]);
    }
  }

  private handle(
    slot: Slot,
    message: {
      type: string;
      id?: number;
      embedding?: ArrayBuffer;
      weight?: number | null;
      ms?: number;
      message?: string;
    },
  ): void {
    if (message.id == null) return;
    if (slot.inflight === message.id) slot.inflight = null;
    const job = this.jobs.get(message.id);
    this.jobs.delete(message.id);
    if (job) {
      if (message.type === "result" && message.embedding) {
        this.counts.embedded++;
        if (typeof message.ms === "number") {
          this.latency = this.latency == null ? message.ms : this.latency * 0.8 + message.ms * 0.2;
        }
        job.resolve({
          embedding: new Float32Array(message.embedding),
          weight: message.weight ?? null,
        });
      } else {
        this.counts.failed++;
        if (!this.loggedFailure) {
          this.loggedFailure = true;
          console.error("saccade.js embed worker:", message.message);
        }
        job.reject(new DeferredFrameDropped("failed", message.message));
      }
    }
    this.pump();
  }
}

function baseUrl(): string {
  return typeof document !== "undefined" && document.baseURI
    ? document.baseURI
    : (globalThis.location?.href ?? "http://localhost/");
}

// ---- choosing a mode -----------------------------------------------------------------------

/** Never run live above this per-frame encode time, however slow the camera, in ms. */
export const LIVE_CEILING_MS = 80;
/** Floor of the live limit, and the limit when the camera's frame rate is unknown, in ms. */
export const LIVE_FLOOR_MS = 30;
/** Share of one camera frame a live encode may take. */
export const LIVE_FRAME_SHARE = 0.85;

export interface ModeDecision {
  mode: "live" | "deferred";
  /** Why, in a few words, for the data. `"requested"` when the caller chose deferred outright. */
  reason: "fast enough" | "no WebGPU" | "too slow" | "requested";
  /** The execution provider the live model ran on. */
  ep: "webgpu" | "wasm";
  /** Median time of one live encode, in ms. */
  embedMs: number;
  /** The camera's measured frame rate, or null if it could not be measured. */
  cameraFps: number | null;
  /** The longest live encode this machine was allowed, in ms. */
  limitMs: number;
}

/**
 * Whether a machine can run the model live, by the rule the validation study used.
 *
 * Live needs WebGPU, and a median encode within 85% of one camera frame (between 30 and 80 ms).
 * The share is high because on WebGPU the encode runs on the GPU, pipelined against the frame
 * loop's CPU work. On wasm the encode runs on the main thread, where a slow one delays
 * everything else on the page, key presses included, so a machine without WebGPU is deferred.
 */
export function chooseMode(m: {
  ep: "webgpu" | "wasm";
  embedMs: number;
  cameraFps: number | null;
}): ModeDecision {
  const limitMs =
    m.cameraFps && m.cameraFps > 0
      ? Math.min(LIVE_CEILING_MS, Math.max(LIVE_FLOOR_MS, (LIVE_FRAME_SHARE * 1000) / m.cameraFps))
      : LIVE_FLOOR_MS;
  const base = { ep: m.ep, embedMs: m.embedMs, cameraFps: m.cameraFps, limitMs };
  if (m.ep !== "webgpu") return { ...base, mode: "deferred", reason: "no WebGPU" };
  if (!(m.embedMs <= limitMs)) return { ...base, mode: "deferred", reason: "too slow" };
  return { ...base, mode: "live", reason: "fast enough" };
}

// ---- gaze from deferred embeddings ---------------------------------------------------------

/** One frame's embedding, with the capture time of the frame it came from. */
export interface TimedEmbedding extends EmbedResult {
  /** `FrameTime.capture` of the frame. */
  time: number;
}

/**
 * Gaze for a run of frames whose embeddings arrived late, computed the way the live loop would
 * have: each estimate is the (weighted) mean of the last `smoothingFrames` embeddings, mapped
 * through `kernel`, and timed by the mean capture time of those frames.
 *
 * `frames` must be in capture order. A gap (a frame with no face, or one whose embedding was
 * lost) does not reset the window, which is also what the live loop does.
 */
export function predictSeries(
  frames: TimedEmbedding[],
  kernel: Float32Array,
  smoothingFrames = 1,
  center = CENTER,
): { gaze: Gaze; time: number }[] {
  const n = Math.max(1, Math.round(smoothingFrames));
  const out: { gaze: Gaze; time: number }[] = [];
  for (let i = 0; i < frames.length; i++) {
    const ring = frames.slice(Math.max(0, i - n + 1), i + 1);
    const weights = ring.every((f) => f.weight != null)
      ? ring.map((f) => f.weight as number)
      : null;
    const mean = meanEmbedding(
      ring.map((f) => f.embedding),
      weights,
    );
    const time = ring.reduce((sum, f) => sum + f.time, 0) / ring.length;
    out.push({ gaze: predict(mean, kernel, center), time });
  }
  return out;
}
