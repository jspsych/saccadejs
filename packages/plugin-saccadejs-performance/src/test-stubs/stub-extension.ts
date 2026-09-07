/**
 * A stand-in for `@saccadejs/extension` for use in this package's tests.
 *
 * It registers under the same extension name (`"saccade"`), so a plugin under test picks it up
 * from `jsPsych.extensions.saccade` exactly as it would the real thing — without a camera, a
 * WebGPU device or a 3 MB ONNX model. Grab the instance from `jsPsych.extensions.saccade` after
 * creating the jsPsych object, and drive the measurement with `tracker.emit()`.
 */
import { JsPsych, JsPsychExtension, JsPsychExtensionInfo } from "jspsych";

export interface StubFrame {
  gaze: { x: number; y: number } | null;
  faceFound: boolean;
  crop: Uint8Array | null;
  fps: number;
  timings: { landmark: number; crop: number; embed: number; total: number };
  time: { capture: number; source: string; dropped: number | null };
}

export function makeFrame(overrides: Partial<StubFrame> = {}): StubFrame {
  return {
    gaze: { x: 0.5, y: 0.5 },
    faceFound: true,
    crop: null,
    fps: 30,
    ...overrides,
    timings: { landmark: 1, crop: 1, embed: 8, total: 10, ...overrides.timings },
    time: { capture: 0, source: "captureTime", dropped: 0, ...overrides.time },
  };
}

export class StubTracker {
  readonly video: HTMLVideoElement = document.createElement("video");
  running = false;
  init = jest.fn(async () => ({ ep: "webgpu" as const, videoWidth: 640, videoHeight: 480 }));
  nextEmbedding = jest.fn(async () => new Float32Array(128));

  private callbacks = new Set<(f: StubFrame) => void>();

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  onFrame(cb: (f: StubFrame) => void) {
    this.callbacks.add(cb);
    return () => {
      this.callbacks.delete(cb);
    };
  }

  /** How many subscribers are attached — used to check the trial unsubscribes when it ends. */
  get subscriberCount(): number {
    return this.callbacks.size;
  }

  /** Test helper: deliver a frame to every subscriber. */
  emit(frame: StubFrame = makeFrame()) {
    for (const cb of [...this.callbacks]) cb(frame);
  }

  /**
   * Test helper: deliver `count` frames spaced `intervalMs` apart, starting at `from`, as
   * though the camera had been running at a steady rate.
   */
  emitSteady(count: number, intervalMs: number, from = 0, overrides: Partial<StubFrame> = {}) {
    for (let i = 0; i < count; i++) {
      this.emit(makeFrame({ ...overrides, time: { capture: from + i * intervalMs } as any }));
    }
  }
}

export class StubSaccadeExtension implements JsPsychExtension {
  static info: JsPsychExtensionInfo = {
    name: "saccade",
    version: "0.0.0",
    data: {},
  };

  readonly tracker = new StubTracker();

  /** Set to make `start()` reject, standing in for a denied camera or a model that will not load. */
  startError: Error | null = null;

  backend: string | null = "webgpu";

  private started = false;

  constructor(private jsPsych: JsPsych) {}

  initialize = async () => {};
  on_start = () => {};
  on_load = () => {};
  on_finish = () => ({});

  start = jest.fn(async () => {
    if (this.startError) throw this.startError;
    this.started = true;
    this.tracker.start();
  });
  pause = jest.fn(() => this.tracker.stop());
  resume = jest.fn(() => this.tracker.start());
  isInitialized = () => this.started;
  faceDetected = () => true;
  getBackend = () => (this.started ? this.backend : null);
  showVideo = jest.fn();
  hideVideo = jest.fn();
  showPredictions = jest.fn();
  hidePredictions = jest.fn();
  getTracker = () => this.tracker as any;
}
