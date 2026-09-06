// Load progress for the one-time setup a tracker does before it can see anything.
//
// `SaccadeTracker.init()` pulls down four separate things — the MediaPipe module and its wasm,
// the face-landmarker task, onnxruntime-web, and the ~20 MB eye-embedding .onnx — and asks for
// the camera on the way. Only the .onnx is fetched by this package, so it is the only one that
// can report bytes; the rest report a stage transition so a UI can say what is happening.

/**
 * Stages of `SaccadeTracker.init()`, in the order they occur:
 *
 * 1. `camera` — asking for `getUserMedia` (the permission prompt appears here)
 * 2. `mediapipe` — loading `@mediapipe/tasks-vision` and its wasm fileset
 * 3. `landmarker` — building the FaceLandmarker (downloads `face_landmarker.task`)
 * 4. `ort` — loading onnxruntime-web
 * 5. `model` — downloading `eye_embedding.onnx`; the only stage with `loaded`/`total`
 * 6. `session` — creating the inference session and warming it up
 * 7. `ready` — init has finished
 *
 * A stage can be reported more than once (`model` reports on every chunk) and stages the caller
 * has taken over — a supplied `stream` or `model` — are skipped.
 */
export type SaccadeProgressStage =
  "camera" | "mediapipe" | "landmarker" | "ort" | "model" | "session" | "ready";

/** One progress report. `loaded`/`total` are bytes, and only the `model` stage has them. */
export interface SaccadeProgress {
  stage: SaccadeProgressStage;
  /** Bytes received so far, when the stage is a download this package performs. */
  loaded?: number;
  /** Total bytes, when the server sent a `Content-Length`. Absent otherwise. */
  total?: number;
}

export type SaccadeProgressCallback = (p: SaccadeProgress) => void;

/**
 * Call `cb` with `p`, swallowing anything it throws: progress is a UI convenience and a broken
 * listener must not take the tracker's init down with it.
 */
export function reportProgress(cb: SaccadeProgressCallback | undefined, p: SaccadeProgress): void {
  if (!cb) return;
  try {
    cb(p);
  } catch {
    // deliberately ignored
  }
}
