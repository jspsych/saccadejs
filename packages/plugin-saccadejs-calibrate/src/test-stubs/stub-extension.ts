/**
 * A stand-in for `@saccadejs/extension` for use in this package's tests.
 *
 * It registers under the same extension name (`"saccade"`), so a plugin under test picks it up
 * from `jsPsych.extensions.saccade` exactly as it would the real thing — without a camera, a
 * WebGPU device or a 3 MB ONNX model. Grab the instance from `jsPsych.extensions.saccade` after
 * creating the jsPsych object.
 */
import { JsPsych, JsPsychExtension, JsPsychExtensionInfo } from "jspsych";

export interface StubFrame {
  gaze: { x: number; y: number } | null;
  faceFound: boolean;
  crop: Uint8Array | null;
  fps: number;
  time: { capture: number; source: string; dropped: number | null };
}

export function makeFrame(overrides: Partial<StubFrame> = {}): StubFrame {
  return {
    gaze: { x: 0.5, y: 0.5 },
    faceFound: true,
    crop: null,
    fps: 30,
    ...overrides,
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

  /** Test helper: deliver a frame to every subscriber. */
  emit(frame: StubFrame = makeFrame()) {
    for (const cb of [...this.callbacks]) cb(frame);
  }
}

export class StubSaccadeExtension implements JsPsychExtension {
  static info: JsPsychExtensionInfo = {
    name: "saccade",
    version: "0.0.0",
    data: {},
  };

  readonly tracker = new StubTracker();

  /** Gaze samples handed to every new `onGazeUpdate` subscriber, synchronously. */
  gazeSamples: Array<{ x: number; y: number; t: number }> = [];

  /** Every `calibratePoint(x, y)` call, in order. */
  calibrationCalls: Array<{ x: number; y: number; captureMs: number }> = [];

  private started = false;
  private offset: number | null = null;
  private loopback: any = null;

  constructor(private jsPsych: JsPsych) {}

  initialize = async () => {};
  on_start = () => {};
  on_load = () => {};
  on_finish = () => ({});

  start = jest.fn(async () => {
    this.started = true;
    this.tracker.start();
  });
  pause = jest.fn(() => this.tracker.stop());
  resume = jest.fn(() => this.tracker.start());
  isInitialized = () => this.started;
  faceDetected = () => true;
  getBackend = () => (this.started ? "webgpu" : null);
  showVideo = jest.fn();
  hideVideo = jest.fn();
  showPredictions = jest.fn();
  hidePredictions = jest.fn();
  resetCalibration = jest.fn(() => {
    this.calibrationCalls = [];
  });

  calibratePoint = jest.fn(
    async (x: number, y: number, _embeddings?: Float32Array[], captureMs = 500) => {
      this.calibrationCalls.push({ x, y, captureMs });
      return 1;
    },
  );

  fitCalibration = jest.fn((lambda?: number) => ({
    lambda: lambda ?? 1,
    nPoints: this.calibrationCalls.length,
  }));

  getCalibrationPoints = () => [];
  getCurrentPrediction = () => this.gazeSamples[this.gazeSamples.length - 1] ?? null;

  onGazeUpdate = (cb: (s: { x: number; y: number; t: number }) => void) => {
    for (const sample of this.gazeSamples) cb(sample);
    return () => {};
  };

  getTracker = () => this.tracker as any;
  getTimingOffset = () => this.offset;
  setTimingOffset = jest.fn((ms: number | null) => {
    this.offset = ms;
  });
  getLastLoopback = () => this.loopback;
  setLastLoopback = jest.fn((r: any) => {
    this.loopback = r;
  });
}
