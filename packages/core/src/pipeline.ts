import { CENTER } from "./grids";
import { extractEyeCrop } from "./crop";
import type { Landmarker } from "./landmarker";
import { predict } from "./ridge";
import type { EmbeddingModel, Gaze } from "./types";
import { EMB_DIM } from "./types";

export interface TrackerTimings {
  landmark: number;
  crop: number;
  embed: number;
  total: number;
  wait?: number;
}

/**
 * Timestamps for one camera frame, all on the `performance.now()` timeline (the clock jsPsych
 * uses), in ms.
 *
 * `capture` is the sample time to record with a gaze estimate: when the camera delivered the
 * frame, not when the prediction became available. Pipeline latency (`emit - capture`) only
 * matters for gaze-contingent designs. What `capture` cannot see is display lag + camera lag;
 * `runLoopback` measures that sum with a screen-to-webcam loopback.
 */
export interface FrameTime {
  /** Best available capture timestamp; see `source` for which field it came from. */
  capture: number;
  /** Which metadata field supplied `capture`. "callback" = no rVFC metadata (rAF fallback). */
  source: "captureTime" | "receiveTime" | "callback";
  /** `VideoFrameCallbackMetadata.receiveTime`, if present. */
  receive: number | null;
  /** `VideoFrameCallbackMetadata.presentedFrames`, if present (monotone frame counter). */
  presentedFrames: number | null;
  /** Frames the camera presented but this loop never saw since the previous frame. */
  dropped: number | null;
  /** `now` argument of the frame callback: when JS got the frame. */
  callback: number;
  /** When the frame was handed to consumers (prediction available). */
  emit: number;
  /**
   * Mean `capture` of the frames in the TTA ring buffer, i.e. the time the smoothed `gaze`
   * actually refers to. Equals `capture` when tta = 1.
   */
  meanCapture: number | null;
}

export interface TrackerFrame {
  gaze: Gaze | null;
  faceFound: boolean;
  crop: Uint8Array | null;
  embedding: Float32Array | null;
  meanEmbedding: Float32Array | null;
  timings: TrackerTimings;
  time: FrameTime;
  fps: number;
  error: string | null;
}

export interface PipelineOptions {
  tta?: number;
  center?: number;
  onFrame?: (frame: TrackerFrame) => void;
}

/** Subset of VideoFrameCallbackMetadata we read (own typing: lib.dom coverage varies by TS version). */
export interface VideoFrameMeta {
  captureTime?: number;
  receiveTime?: number;
  presentedFrames?: number;
}

export type VideoFrameCallbackHost = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface Stage {
  t0: number;
  time: FrameTime;
  landmark: number;
  crop: number;
  faceFound: boolean;
  eye: Uint8Array | null;
  error: string | null;
}

interface RingEntry {
  e: Float32Array;
  t: number;
}

/**
 * How long to wait for `requestVideoFrameCallback` before falling back to a plain tick. Long
 * enough that a healthy 15 fps camera never trips it, short enough that a stalled loop recovers
 * within a few frames.
 */
const RVFC_WATCHDOG_MS = 300;

interface InFlight {
  stage: Stage;
  started: number;
  finished: number;
  epoch: number;
  promise: Promise<Float32Array>;
}

/**
 * The per-frame loop: landmark -> crop -> embed -> TTA mean -> gaze.
 *
 * The step is pipelined — the CPU work for frame N+1 (draw, landmark, crop) overlaps the GPU
 * embed of frame N, and exactly one `session.run` is ever in flight.
 */
export class Pipeline {
  private video: VideoFrameCallbackHost;
  private landmarker: Landmarker;
  private model: EmbeddingModel;
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private active = false;
  private busy = false;
  private handle: number | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every `schedule()`; a callback from an older generation is ignored. */
  private schedGen = 0;
  private ring: RingEntry[] = [];
  private tta: number;
  private center: number;
  private kernel: Float32Array | null = null;
  private lastFrameTime = 0;
  private lastPresented: number | null = null;
  private fps = 0;
  private loggedError = false;
  private waiters: ((frame: TrackerFrame) => void)[] = [];
  private inflight: InFlight | null = null;
  private epoch = 0;
  onFrame: ((frame: TrackerFrame) => void) | null;

  constructor(
    video: HTMLVideoElement,
    landmarker: Landmarker,
    model: EmbeddingModel,
    opts: PipelineOptions = {},
  ) {
    this.video = video as VideoFrameCallbackHost;
    this.landmarker = landmarker;
    this.model = model;
    this.tta = opts.tta ?? 5;
    this.center = opts.center ?? CENTER;
    this.onFrame = opts.onFrame ?? null;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
  }

  get running(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.schedule();
  }

  stop(): void {
    this.active = false;
    // An in-flight embed is deliberately left in `inflight`: the next step awaits it before
    // starting another, which is what keeps session.run non-concurrent.
    this.epoch++;
    this.schedGen++;
    this.clearWatchdog();
    if (this.handle != null && this.video.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.handle);
    }
    this.handle = null;
  }

  setKernel(kernel: Float32Array | null): void {
    this.kernel = kernel;
  }

  hasKernel(): boolean {
    return this.kernel != null;
  }

  setTta(n: number): void {
    this.tta = Math.max(1, Math.round(n));
    while (this.ring.length > this.tta) this.ring.shift();
  }

  getTta(): number {
    return this.tta;
  }

  setCenter(center: number): void {
    this.center = center;
  }

  setModel(model: EmbeddingModel): void {
    this.model = model;
    this.ring = [];
    this.epoch++;
  }

  clearBuffer(): void {
    this.ring = [];
    this.epoch++;
  }

  nextFrame(): Promise<TrackerFrame> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async nextEmbedding(): Promise<Float32Array | null> {
    return (await this.nextFrame()).embedding;
  }

  async nextGaze(): Promise<Gaze | null> {
    return (await this.nextFrame()).gaze;
  }

  private schedule(): void {
    if (!this.active) return;
    const gen = ++this.schedGen;
    this.clearWatchdog();
    if (this.video.requestVideoFrameCallback) {
      this.handle = this.video.requestVideoFrameCallback((now, meta) => {
        if (gen !== this.schedGen) return;
        this.clearWatchdog();
        void this.tick(now, meta);
      });
      this.armWatchdog(gen);
    } else {
      this.handle = requestAnimationFrame((now) => {
        if (gen !== this.schedGen) return;
        void this.tick(now, null);
      });
    }
  }

  /**
   * Self-healing for a video that stops delivering `requestVideoFrameCallback`s.
   *
   * Chrome only fires rVFC for a rendered video element, so a host that hides or detaches the
   * element kills the loop with no error: no frames, and every `nextFrame()` waiter hangs
   * forever (which is what stalls a calibration run). The tracker keeps the element attached,
   * but this is the belt to that pair of braces: if rVFC has not fired within the watchdog and
   * the element still has frame data, cancel the pending callback and tick anyway on the plain
   * `performance.now()` clock (`time.source === "callback"`, the same path used when rVFC does
   * not exist at all). Scheduling then goes back to rVFC, so a stream that recovers is used
   * with its proper timestamps again.
   */
  private armWatchdog(gen: number): void {
    if (typeof setTimeout !== "function") return;
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (!this.active || gen !== this.schedGen) return;
      // No frame data yet (the camera is still starting): wait, do not fabricate a tick.
      if (this.video.readyState < 2 || this.video.paused) {
        this.armWatchdog(gen);
        return;
      }
      // Invalidate the pending rVFC before ticking, so a late one cannot start a second loop.
      this.schedGen++;
      if (this.handle != null && this.video.cancelVideoFrameCallback) {
        this.video.cancelVideoFrameCallback(this.handle);
      }
      this.handle = null;
      void this.tick(performance.now(), null);
    }, RVFC_WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog != null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private async tick(now: number, meta: VideoFrameMeta | null): Promise<void> {
    if (!this.active) return;
    if (this.busy) {
      this.schedule();
      return;
    }
    this.busy = true;
    try {
      await this.step(this.frameTime(now, meta));
    } catch (err) {
      this.describe(err);
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  /**
   * Build the FrameTime for a frame from the rVFC metadata. Preference order for the sample
   * timestamp: captureTime (camera delivery, closest to the exposure) > receiveTime (arrival
   * in the renderer) > callback now.
   */
  private frameTime(now: number, meta: VideoFrameMeta | null): FrameTime {
    const captureTime = meta?.captureTime;
    const receiveTime = meta?.receiveTime;
    const presented = meta?.presentedFrames ?? null;
    let capture = now;
    let source: FrameTime["source"] = "callback";
    if (typeof captureTime === "number" && Number.isFinite(captureTime)) {
      capture = captureTime;
      source = "captureTime";
    } else if (typeof receiveTime === "number" && Number.isFinite(receiveTime)) {
      capture = receiveTime;
      source = "receiveTime";
    }
    let dropped: number | null = null;
    if (presented != null) {
      dropped = this.lastPresented == null ? 0 : Math.max(0, presented - this.lastPresented - 1);
      this.lastPresented = presented;
    }
    return {
      capture,
      source,
      receive: typeof receiveTime === "number" ? receiveTime : null,
      presentedFrames: presented,
      dropped,
      callback: now,
      emit: 0,
      meanCapture: null,
    };
  }

  private async step(time: FrameTime): Promise<void> {
    const t0 = performance.now();
    if (this.lastFrameTime > 0) {
      const dt = t0 - this.lastFrameTime;
      if (dt > 0) this.fps = this.fps === 0 ? 1000 / dt : this.fps * 0.9 + (1000 / dt) * 0.1;
    }
    this.lastFrameTime = t0;

    const stage = this.capture(t0, time);
    const pending = this.inflight;
    this.inflight = null;
    const retired = pending ? await this.retire(pending) : null;
    if (!this.active) return;
    const started = this.startEmbed(stage);
    if (retired) this.emit(retired);
    if (!started) {
      this.emit({
        gaze: null,
        faceFound: stage.faceFound,
        crop: null,
        embedding: null,
        meanEmbedding: null,
        timings: {
          landmark: stage.landmark,
          crop: stage.crop,
          embed: 0,
          wait: 0,
          total: performance.now() - stage.t0,
        },
        time: stage.time,
        fps: this.fps,
        error: stage.error,
      });
    }
  }

  private capture(t0: number, time: FrameTime): Stage {
    const stage: Stage = {
      t0,
      time,
      landmark: 0,
      crop: 0,
      faceFound: false,
      eye: null,
      error: null,
    };
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    if (!W || !H) return stage;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    try {
      // Never mirrored: the model was trained on unmirrored frames. A preview may be
      // CSS-mirrored, which does not touch these pixels.
      this.ctx.drawImage(this.video, 0, 0, W, H);
      const image = this.ctx.getImageData(0, 0, W, H);
      const t1 = performance.now();
      const lm = this.landmarker.detect(this.video, t1);
      const t2 = performance.now();
      stage.landmark = t2 - t1;
      if (lm) {
        stage.faceFound = true;
        const eye = extractEyeCrop(image.data, W, H, lm);
        stage.crop = performance.now() - t2;
        if (eye) stage.eye = eye.data;
      }
    } catch (err) {
      stage.error = this.describe(err);
    }
    return stage;
  }

  private startEmbed(stage: Stage): boolean {
    if (!stage.eye) return false;
    const p = { stage, started: performance.now(), finished: 0, epoch: this.epoch } as InFlight;
    p.promise = this.model.embed(stage.eye).then(
      (e) => {
        p.finished = performance.now();
        return e;
      },
      (err: unknown) => {
        p.finished = performance.now();
        throw err;
      },
    );
    this.inflight = p;
    return true;
  }

  private async retire(p: InFlight): Promise<TrackerFrame | null> {
    const tw = performance.now();
    let embedding: Float32Array | null = null;
    let error = p.stage.error;
    try {
      embedding = await p.promise;
    } catch (err) {
      error = this.describe(err);
    }
    const embed = p.finished - p.started;
    const wait = Math.max(0, p.finished - tw);
    if (p.epoch !== this.epoch) return null;

    let mean: Float32Array | null = null;
    let gaze: Gaze | null = null;
    let meanCapture: number | null = null;
    if (embedding) {
      this.ring.push({ e: embedding, t: p.stage.time.capture });
      while (this.ring.length > this.tta) this.ring.shift();
      mean = this.meanEmbedding();
      meanCapture = this.meanCaptureTime();
      if (this.kernel && mean) gaze = predict(mean, this.kernel, this.center);
    }
    return {
      gaze,
      faceFound: p.stage.faceFound,
      crop: p.stage.eye,
      embedding,
      meanEmbedding: mean,
      timings: {
        landmark: p.stage.landmark,
        crop: p.stage.crop,
        embed,
        wait,
        total: performance.now() - p.stage.t0,
      },
      time: { ...p.stage.time, meanCapture },
      fps: this.fps,
      error,
    };
  }

  private describe(err: unknown): string {
    if (!this.loggedError) {
      this.loggedError = true;
      console.error("saccade.js frame failed:", err);
    }
    return err instanceof Error ? err.message : String(err);
  }

  private meanEmbedding(): Float32Array | null {
    if (this.ring.length === 0) return null;
    const mean = new Float32Array(EMB_DIM);
    for (const { e } of this.ring) for (let i = 0; i < EMB_DIM; i++) mean[i] += e[i];
    for (let i = 0; i < EMB_DIM; i++) mean[i] /= this.ring.length;
    return mean;
  }

  private meanCaptureTime(): number | null {
    if (this.ring.length === 0) return null;
    let sum = 0;
    for (const { t } of this.ring) sum += t;
    return sum / this.ring.length;
  }

  private emit(frame: TrackerFrame): void {
    frame.time.emit = performance.now();
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w(frame);
    this.onFrame?.(frame);
  }
}
