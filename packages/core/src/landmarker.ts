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
  /**
   * Also estimate the head's pose on every frame: MediaPipe's facial transformation matrix,
   * returned by `detectFace()`. Off by default — the tracker does not need it, and it adds
   * MediaPipe's face-geometry step to every detection.
   */
  headPose?: boolean;
}

/** One detection: the face mesh, and the head pose when the landmarker was built with it. */
export interface FaceDetection {
  landmarks: Landmark[];
  /**
   * The 4x4 rigid transform from MediaPipe's canonical face model to this face, column-major
   * (translation in elements 12-14), or null when `headPose` is off. Translation is in
   * MediaPipe's model units, roughly centimeters under its assumed camera field of view.
   * `headPoseFromMatrix()` turns it into angles.
   */
  pose: Float32Array | null;
}

/** A head pose as angles and a position. See `headPoseFromMatrix`. */
export interface HeadPose {
  /** Turning left and right, in degrees. */
  yaw: number;
  /** Nodding up and down, in degrees. */
  pitch: number;
  /** Tilting toward a shoulder, in degrees. */
  roll: number;
  /** Position of the face relative to the camera, in MediaPipe's model units (about cm). */
  x: number;
  y: number;
  z: number;
}

/**
 * MediaPipe FaceLandmarker in VIDEO mode, one face, GPU delegate with a CPU fallback.
 * `detect` enforces strictly increasing timestamps, which the task requires.
 */
export class Landmarker {
  readonly delegate: "GPU" | "CPU";
  readonly headPose: boolean;
  private fl: FaceLandmarker;
  private lastTs = -1;

  private constructor(fl: FaceLandmarker, delegate: "GPU" | "CPU", headPose: boolean) {
    this.fl = fl;
    this.delegate = delegate;
    this.headPose = headPose;
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
        outputFacialTransformationMatrixes: !!opts.headPose,
      });
    const headPose = !!opts.headPose;
    try {
      return new Landmarker(await build("GPU"), "GPU", headPose);
    } catch {
      return new Landmarker(await build("CPU"), "CPU", headPose);
    }
  }

  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null {
    return this.detectFace(video, timestampMs)?.landmarks ?? null;
  }

  /** The face mesh and, when built with `headPose`, the head-pose matrix. Null with no face. */
  detectFace(video: HTMLVideoElement, timestampMs: number): FaceDetection | null {
    let ts = timestampMs;
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const res = this.fl.detectForVideo(video, ts);
    const faces = res.faceLandmarks;
    if (!faces || faces.length === 0) return null;
    const matrix = this.headPose ? res.facialTransformationMatrixes?.[0] : undefined;
    return {
      landmarks: faces[0] as Landmark[],
      pose: matrix && matrix.data?.length === 16 ? columnMajor(matrix.data) : null,
    };
  }

  close(): void {
    this.fl.close();
  }
}

export function createLandmarker(opts: LandmarkerOptions = {}): Promise<Landmarker> {
  return Landmarker.create(opts);
}

/**
 * A rigid 4x4 transform, as column-major values, whichever way MediaPipe flattened it.
 *
 * `Matrix.data` does not document its order, so the matrix is asked instead: a rigid transform
 * has `[0, 0, 0, 1]` as its bottom row and its translation in the last column. Column-major puts
 * that bottom row at elements 3, 7, 11 and 15; row-major puts it at 12-15. Whichever layout has
 * the zeros there is the one it is in.
 */
function columnMajor(data: ArrayLike<number>): Float32Array {
  const m = Float32Array.from(data);
  const bottomIfColumnMajor = Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]);
  const bottomIfRowMajor = Math.abs(m[12]) + Math.abs(m[13]) + Math.abs(m[14]);
  if (bottomIfColumnMajor <= bottomIfRowMajor) return m;
  const t = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) t[c * 4 + r] = m[r * 4 + c];
  return t;
}

const DEG = 180 / Math.PI;

/**
 * Yaw, pitch and roll, in degrees, and the position, from a column-major head-pose matrix.
 *
 * The rotation is decomposed as R = Ry(yaw) Rx(pitch) Rz(roll) -- turn, then nod, then tilt --
 * about the axes of MediaPipe's canonical face model. All three are 0 for a face looking
 * straight into the camera. Which direction counts as positive follows from MediaPipe's axes,
 * which it does not document here; check the signs against a deliberate head turn before
 * interpreting one.
 */
export function headPoseFromMatrix(m: ArrayLike<number>): HeadPose {
  // Column-major: element (row r, column c) is m[c * 4 + r].
  const at = (r: number, c: number) => m[c * 4 + r];
  const pitch = Math.asin(Math.max(-1, Math.min(1, -at(1, 2))));
  const yaw = Math.atan2(at(0, 2), at(2, 2));
  const roll = Math.atan2(at(1, 0), at(1, 1));
  return { yaw: yaw * DEG, pitch: pitch * DEG, roll: roll * DEG, x: m[12], y: m[13], z: m[14] };
}
