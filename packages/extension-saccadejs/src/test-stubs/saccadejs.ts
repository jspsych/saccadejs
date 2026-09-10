/**
 * Runtime stub for the `saccadejs` core package.
 *
 * `jest.config.cjs` maps `saccadejs` onto this file, so the extension's tests exercise the
 * extension itself rather than the real tracker (which needs a camera, WebGPU and a 3 MB ONNX
 * model). The shape follows the core API fixed in `CONTRACTS.md`.
 */

export interface StubFrame {
  gaze: { x: number; y: number } | null;
  faceFound: boolean;
  crop: Uint8Array | null;
  embedding: Float32Array | null;
  weight: number | null;
  meanEmbedding: Float32Array | null;
  timings: { landmark: number; crop: number; embed: number; total: number };
  time: {
    capture: number;
    source: "captureTime" | "receiveTime" | "callback";
    receive: number | null;
    presentedFrames: number | null;
    dropped: number | null;
    callback: number;
    emit: number;
    meanCapture: number | null;
  };
  fps: number;
  error: string | null;
}

/** Build a plausible tracker frame; override anything the test cares about. */
export function makeFrame(overrides: Partial<StubFrame> = {}): StubFrame {
  const capture = overrides.time?.capture ?? 0;
  return {
    gaze: { x: 0.5, y: 0.5 },
    faceFound: true,
    crop: null,
    embedding: new Float32Array(128),
    weight: null,
    meanEmbedding: new Float32Array(128),
    timings: { landmark: 1, crop: 1, embed: 1, total: 3 },
    fps: 30,
    error: null,
    ...overrides,
    time: {
      capture,
      source: "captureTime",
      receive: null,
      presentedFrames: null,
      dropped: 0,
      callback: capture,
      emit: capture,
      meanCapture: capture,
      ...overrides.time,
    },
  };
}

export class SaccadeTracker {
  static instances: SaccadeTracker[] = [];

  readonly video: HTMLVideoElement = document.createElement("video");
  running = false;
  calibrationPoints: Array<{
    target: { x: number; y: number };
    embeddings: Float32Array[];
    weights: number[] | null;
    meanEmbedding: Float32Array;
  }> = [];
  /** Mirrors the real tracker's `initialized` getter, which gates the handed-tracker path. */
  initialized = false;

  init = jest.fn(async () => {
    this.initialized = true;
    return { ep: "webgpu" as const, videoWidth: 640, videoHeight: 480 };
  });
  nextEmbedding = jest.fn(async () => new Float32Array(128));
  nextSample = jest.fn(async () => ({
    embedding: new Float32Array(128),
    weight: null as number | null,
  }));

  private callbacks = new Set<(f: StubFrame) => void>();

  smoothingFrames = 1;

  constructor(public options: Record<string, any> = {}) {
    this.smoothingFrames = options.smoothingFrames ?? 1;
    SaccadeTracker.instances.push(this);
  }

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  /** Overridable per test: what `getModelIdentity()` should report. */
  modelIdentity: {
    sha256: string | null;
    version: string | null;
    contract: number | null;
    url: string | null;
    resolvedFrom: "registry" | "hash-only" | "unverified";
    dim: number | null;
    emitsWeight: boolean;
  } | null = {
    sha256: "5a1a111e37f97bd50fcffccbf6498bf377700d27cd4e3ea5bc5d237541a3c73a",
    version: "1.0.0",
    contract: 1,
    url: "/models/eye-embedding/1.0.0/eye_embedding.onnx",
    resolvedFrom: "registry",
    dim: 128,
    emitsWeight: true,
  };

  getModelIdentity() {
    return this.modelIdentity;
  }

  dispose() {
    this.callbacks.clear();
  }

  onFrame(cb: (f: StubFrame) => void) {
    this.callbacks.add(cb);
    return () => {
      this.callbacks.delete(cb);
    };
  }

  /** Test helper: deliver a frame to every subscriber. */
  emit(frame: StubFrame) {
    for (const cb of [...this.callbacks]) cb(frame);
  }

  /** Test helper: how many subscribers are currently attached. */
  get subscriberCount() {
    return this.callbacks.size;
  }

  async nextFrame() {
    return makeFrame();
  }

  addCalibrationPoint(
    target: { x: number; y: number },
    embeddings: Float32Array[],
    weights?: number[] | null,
  ) {
    this.calibrationPoints.push({
      target,
      embeddings,
      weights: weights ?? null,
      meanEmbedding: embeddings[0],
    });
  }

  clearCalibration() {
    this.calibrationPoints = [];
  }

  getCalibrationPoints() {
    return this.calibrationPoints;
  }

  fitCalibration(opts?: { lambda?: number }) {
    if (this.calibrationPoints.length === 0) return null;
    return {
      lambda: opts?.lambda ?? 1,
      nPoints: this.calibrationPoints.length,
      weighting: "uniform" as const,
    };
  }

  get calibrated() {
    return this.calibrationPoints.length > 0;
  }

  setSmoothingFrames(n: number) {
    this.smoothingFrames = Math.max(1, Math.round(n));
  }

  getSmoothingFrames() {
    return this.smoothingFrames;
  }

  getCurrentGaze() {
    return null;
  }

  sampleLuminance() {
    return 0;
  }
}

export const DEFAULT_FRAME_TIMEOUT_MS = 5000;

/** The real implementation, restated here because the whole core module is stubbed out. */
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

export const runLoopback = jest.fn();
export const defaultGrid13 = () => [];
export const trainingGrid20 = () => [];
export const validationGrid9 = () => [];
export const lambdaFor = (n: number) => (n <= 9 ? 3 : 1);
export const version = "0.0.0-stub";

/** Mirrors the real implementation in core's types.ts -- kept in step by a test there. */
export function formatModelIdentity(
  id: { version: string | null; sha256: string | null } | null | undefined,
): string {
  if (!id) return "unverified";
  if (id.version) return `eye-embedding@${id.version}`;
  if (id.sha256) return `sha256:${id.sha256.slice(0, 12)}`;
  return "unverified";
}
