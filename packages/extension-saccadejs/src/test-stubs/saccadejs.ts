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
    meanEmbedding: Float32Array;
  }> = [];
  init = jest.fn(async () => ({ ep: "webgpu" as const, videoWidth: 640, videoHeight: 480 }));
  nextEmbedding = jest.fn(async () => new Float32Array(128));

  private callbacks = new Set<(f: StubFrame) => void>();

  constructor(public options: Record<string, any> = {}) {
    SaccadeTracker.instances.push(this);
  }

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
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

  addCalibrationPoint(target: { x: number; y: number }, embeddings: Float32Array[]) {
    this.calibrationPoints.push({ target, embeddings, meanEmbedding: embeddings[0] });
  }

  clearCalibration() {
    this.calibrationPoints = [];
  }

  getCalibrationPoints() {
    return this.calibrationPoints;
  }

  fitCalibration(opts?: { lambda?: number }) {
    if (this.calibrationPoints.length === 0) return null;
    return { lambda: opts?.lambda ?? 1, nPoints: this.calibrationPoints.length };
  }

  get calibrated() {
    return this.calibrationPoints.length > 0;
  }

  setTta(_n: number) {}

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
