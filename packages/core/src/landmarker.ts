import type { FaceLandmarker } from "@mediapipe/tasks-vision";

import type { SaccadeAssets } from "./assets";
import { faceLandmarkerUrl, loadVision, mediapipeWasmUrl } from "./assets";
import type { SaccadeProgressCallback } from "./progress";
import { reportProgress } from "./progress";
import type { Landmark } from "./types";

export interface LandmarkerOptions {
  assets?: SaccadeAssets;
  /** Load progress: the `mediapipe` and `landmarker` stages. No byte counts — MediaPipe
   *  fetches its own wasm and `.task` file. */
  onProgress?: SaccadeProgressCallback;
}

/**
 * MediaPipe FaceLandmarker in VIDEO mode, one face, GPU delegate with a CPU fallback.
 * `detect` enforces strictly increasing timestamps, which the task requires.
 */
export class Landmarker {
  readonly delegate: "GPU" | "CPU";
  private fl: FaceLandmarker;
  private lastTs = -1;

  private constructor(fl: FaceLandmarker, delegate: "GPU" | "CPU") {
    this.fl = fl;
    this.delegate = delegate;
  }

  static async create(opts: LandmarkerOptions = {}): Promise<Landmarker> {
    const assets = opts.assets ?? {};
    reportProgress(opts.onProgress, { stage: "mediapipe" });
    const vision = await loadVision(assets);
    const fileset = await vision.FilesetResolver.forVisionTasks(mediapipeWasmUrl(assets));
    reportProgress(opts.onProgress, { stage: "landmarker" });
    const build = (delegate: "GPU" | "CPU") =>
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: faceLandmarkerUrl(assets), delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    try {
      return new Landmarker(await build("GPU"), "GPU");
    } catch {
      return new Landmarker(await build("CPU"), "CPU");
    }
  }

  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null {
    let ts = timestampMs;
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const res = this.fl.detectForVideo(video, ts);
    const faces = res.faceLandmarks;
    if (!faces || faces.length === 0) return null;
    return faces[0] as Landmark[];
  }

  close(): void {
    this.fl.close();
  }
}

export function createLandmarker(opts: LandmarkerOptions = {}): Promise<Landmarker> {
  return Landmarker.create(opts);
}
