import type { SaccadeAssets } from "./assets";
import { CAL_HEAD, CENTER, fitRidge, lambdaFor, meanEmbedding } from "./grids";
import { Landmarker } from "./landmarker";
import { OrtEmbeddingModel } from "./model";
import type { FrameTime, TrackerFrame } from "./pipeline";
import { Pipeline } from "./pipeline";
import type { SaccadeProgressCallback } from "./progress";
import { reportProgress } from "./progress";
import type { CalPoint, EmbeddingModel, Gaze } from "./types";

export interface SaccadeTrackerOptions {
  assets?: SaccadeAssets;
  /** getUserMedia ideals. Default 640x480, user-facing. */
  video?: { width?: number; height?: number };
  /** Ring-buffer length for test-time augmentation (embeddings averaged). Default 5. */
  tta?: number;
  /** ONNX Runtime execution providers, tried in order. Default ["webgpu", "wasm"]. */
  executionProviders?: ("webgpu" | "wasm")[];
  onFrame?: (f: TrackerFrame) => void;
  /**
   * Called as `init()` walks its load stages, so a page can show a setup screen instead of a
   * blank wait. The `model` stage carries byte counts for the ~20 MB `.onnx`. Optional: with
   * no callback nothing about init changes. See `SaccadeProgress`.
   */
  onProgress?: SaccadeProgressCallback;
  /**
   * Extension to the published contract: use this camera stream instead of calling
   * getUserMedia. Useful when the page already owns the camera.
   */
  stream?: MediaStream;
  /** Extension: substitute the embedding model (tests, or a pre-warmed session). */
  model?: EmbeddingModel;
}

export interface InitResult {
  ep: "webgpu" | "wasm";
  videoWidth: number;
  videoHeight: number;
}

const LUM_W = 64;
const LUM_H = 48;

/**
 * Camera + face landmarks + eye embedding + calibration, as one object.
 *
 * Nothing happens until `init()` (which asks for the camera); after that `start()` runs the
 * frame loop and every subscriber gets a `TrackerFrame` per camera frame. `gaze` stays null
 * until calibration points have been added and `fitCalibration()` has run.
 */
export class SaccadeTracker {
  readonly video: HTMLVideoElement;
  private opts: SaccadeTrackerOptions;
  private assets: SaccadeAssets;
  private landmarker: Landmarker | null = null;
  private model: EmbeddingModel | null = null;
  private pipeline: Pipeline | null = null;
  private stream: MediaStream | null = null;
  private ownsStream = false;
  private initPromise: Promise<InitResult> | null = null;
  private initResult: InitResult | null = null;
  private cal: CalPoint[] = [];
  private kernel: Float32Array | null = null;
  private lastGaze: { gaze: Gaze; time: FrameTime } | null = null;
  private subscribers = new Set<(f: TrackerFrame) => void>();
  private tta: number;
  private wantRunning = false;
  private disposed = false;
  private lumCanvas: HTMLCanvasElement | null = null;
  private lumCtx: CanvasRenderingContext2D | null = null;

  constructor(opts: SaccadeTrackerOptions = {}) {
    this.opts = opts;
    this.assets = opts.assets ?? {};
    this.tta = opts.tta ?? 5;
    if (opts.onFrame) this.subscribers.add(opts.onFrame);
    this.video = document.createElement("video");
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute("playsinline", "");
  }

  /** Requests the camera, loads MediaPipe + ONNX and warms them up. Idempotent. */
  init(): Promise<InitResult> {
    if (!this.initPromise) {
      this.initPromise = this.doInit();
      this.initPromise.catch(() => {
        this.initPromise = null;
      });
    }
    return this.initPromise;
  }

  get initialized(): boolean {
    return this.initResult !== null;
  }

  private async doInit(): Promise<InitResult> {
    if (this.disposed) throw new Error("tracker disposed");
    const onProgress = this.opts.onProgress;
    const width = this.opts.video?.width ?? 640;
    const height = this.opts.video?.height ?? 480;
    if (this.opts.stream) {
      this.stream = this.opts.stream;
      this.ownsStream = false;
    } else {
      reportProgress(onProgress, { stage: "camera" });
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: width }, height: { ideal: height }, facingMode: "user" },
        audio: false,
      });
      this.ownsStream = true;
    }
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch {
      // Autoplay policy, or a runtime without a real media element: the frame loop only needs
      // frames to arrive, and they do as soon as the stream is attached.
    }
    if (!this.video.videoWidth) {
      await new Promise<void>((resolve) => {
        const done = (): void => resolve();
        this.video.addEventListener("loadedmetadata", done, { once: true });
        // jsdom and some headless setups never fire it; do not hang the caller.
        setTimeout(done, 3000);
      });
    }

    this.landmarker = await Landmarker.create({ assets: this.assets, onProgress });
    let ep: "webgpu" | "wasm" = "wasm";
    if (this.opts.model) {
      this.model = this.opts.model;
      ep = (await this.model.init()).ep;
    } else {
      const model = new OrtEmbeddingModel({
        assets: this.assets,
        executionProviders: this.opts.executionProviders,
        onProgress,
      });
      ep = (await model.init()).ep;
      this.model = model;
    }

    this.pipeline = new Pipeline(this.video, this.landmarker, this.model, {
      tta: this.tta,
      center: CENTER,
      onFrame: (f) => this.handleFrame(f),
    });
    if (this.kernel) this.pipeline.setKernel(this.kernel);

    this.initResult = {
      ep,
      videoWidth: this.video.videoWidth,
      videoHeight: this.video.videoHeight,
    };
    if (this.wantRunning) this.pipeline.start();
    reportProgress(onProgress, { stage: "ready" });
    return this.initResult;
  }

  private handleFrame(f: TrackerFrame): void {
    if (f.gaze) this.lastGaze = { gaze: f.gaze, time: f.time };
    for (const cb of Array.from(this.subscribers)) cb(f);
  }

  /** Start the frame loop. Safe before `init()`: the loop starts as soon as init finishes. */
  start(): void {
    this.wantRunning = true;
    this.pipeline?.start();
  }

  stop(): void {
    this.wantRunning = false;
    this.pipeline?.stop();
  }

  get running(): boolean {
    return this.pipeline ? this.pipeline.running : false;
  }

  /** Stop everything and release the camera. The tracker cannot be re-initialised after this. */
  dispose(): void {
    this.disposed = true;
    this.stop();
    this.pipeline = null;
    this.landmarker?.close();
    this.landmarker = null;
    const model = this.model as { dispose?: () => void } | null;
    model?.dispose?.();
    this.model = null;
    if (this.stream && this.ownsStream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.subscribers.clear();
    this.initResult = null;
    this.initPromise = null;
  }

  /** Subscribe to every frame. Returns the unsubscribe function. */
  onFrame(cb: (f: TrackerFrame) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /** Resolves with the next frame the loop emits. */
  nextFrame(): Promise<TrackerFrame> {
    if (!this.pipeline) return this.afterInit((p) => p.nextFrame());
    return this.pipeline.nextFrame();
  }

  async nextEmbedding(): Promise<Float32Array | null> {
    return (await this.nextFrame()).embedding;
  }

  async nextGaze(): Promise<Gaze | null> {
    return (await this.nextFrame()).gaze;
  }

  private async afterInit<T>(fn: (p: Pipeline) => Promise<T>): Promise<T> {
    await this.init();
    if (!this.pipeline) throw new Error("tracker not initialised");
    return fn(this.pipeline);
  }

  // ---------------------------------------------------------------- calibration

  addCalibrationPoint(target: Gaze, embeddings: Float32Array[]): void {
    if (embeddings.length === 0) return;
    this.cal.push({ target, embeddings, meanEmbedding: meanEmbedding(embeddings) });
  }

  clearCalibration(): void {
    this.cal = [];
    this.kernel = null;
    this.lastGaze = null;
    this.pipeline?.setKernel(null);
  }

  getCalibrationPoints(): CalPoint[] {
    return this.cal.slice();
  }

  /** Solve the ridge map from the points added so far. Null when there is nothing to fit. */
  fitCalibration(opts: { lambda?: number; center?: number } = {}): {
    lambda: number;
    nPoints: number;
  } | null {
    if (this.cal.length === 0) return null;
    const lambda = opts.lambda ?? lambdaFor(this.cal.length);
    const center = opts.center ?? CENTER;
    this.kernel = fitRidge(this.cal, CAL_HEAD, lambda, center);
    this.pipeline?.setCenter(center);
    this.pipeline?.setKernel(this.kernel);
    return { lambda, nPoints: this.cal.length };
  }

  get calibrated(): boolean {
    return this.kernel != null;
  }

  /** The fitted 256-long kernel (x and y interleaved), or null. */
  getKernel(): Float32Array | null {
    return this.kernel;
  }

  setTta(n: number): void {
    this.tta = Math.max(1, Math.round(n));
    this.pipeline?.setTta(this.tta);
  }

  getTta(): number {
    return this.tta;
  }

  /** Latest gaze (viewport fractions) and the times of the frame it came from, or null. */
  getCurrentGaze(): { gaze: Gaze; time: FrameTime } | null {
    return this.lastGaze;
  }

  /**
   * Mean luminance of the whole current camera frame (BT.601 on a 64x48 downsample). This is
   * what the timing loopback correlates against the screen; it is public so plugins can reuse
   * the tracker's video instead of opening a second stream.
   */
  sampleLuminance(): number {
    if (!this.lumCanvas) {
      this.lumCanvas = document.createElement("canvas");
      this.lumCanvas.width = LUM_W;
      this.lumCanvas.height = LUM_H;
      this.lumCtx = this.lumCanvas.getContext("2d", { willReadFrequently: true });
    }
    const ctx = this.lumCtx;
    if (!ctx) return NaN;
    ctx.drawImage(this.video, 0, 0, LUM_W, LUM_H);
    const d = ctx.getImageData(0, 0, LUM_W, LUM_H).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    return sum / (LUM_W * LUM_H);
  }
}
