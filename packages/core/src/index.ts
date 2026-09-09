import { version as packageVersion } from "../package.json";

// ---- assets ------------------------------------------------------------------
export type { SaccadeAssets } from "./assets";
export {
  DEFAULT_FACE_LANDMARKER_URL,
  DEFAULT_MEDIAPIPE_WASM_URL,
  DEFAULT_ORT_WASM_URL,
  MEDIAPIPE_VERSION,
  ORT_VERSION,
  loadOrt,
  loadVision,
  modelUrl,
  presetModules,
} from "./assets";

// ---- core types --------------------------------------------------------------
export type {
  BBox,
  CalHead,
  CalPoint,
  Embedding,
  EmbeddingModel,
  EyeCrop,
  Gaze,
  Landmark,
  ModelIdentity,
  RidgeRow,
} from "./types";
export { EMB_DIM, EYE_H, EYE_W, formatModelIdentity } from "./types";

// ---- load progress -----------------------------------------------------------
export type { SaccadeProgress, SaccadeProgressCallback, SaccadeProgressStage } from "./progress";

// ---- tracker -----------------------------------------------------------------
export type { FrameTime, TrackerFrame, TrackerTimings } from "./pipeline";
export { Pipeline } from "./pipeline";
export type { InitResult, SaccadeTrackerOptions } from "./tracker";
export { SaccadeTracker } from "./tracker";
export { Landmarker, createLandmarker } from "./landmarker";
export { OrtEmbeddingModel, StubEmbeddingModel } from "./model";

// ---- preprocessing (bit-exact with the training pipeline) --------------------
export type { ClaheOptions } from "./crop";
export { clahe, cropBBox, extractEyeCrop, resizeBilinearCv, rgbaToGray } from "./crop";

// ---- calibration -------------------------------------------------------------
export { calWeight, predict, solveRidge } from "./ridge";
export {
  CAL_HEAD,
  CENTER,
  DEFAULT_CAPTURE_MS,
  DEFAULT_SETTLE_MS,
  defaultGrid13,
  fitRidge,
  lambdaFor,
  meanEmbedding,
  median,
  trainingGrid20,
  validationGrid9,
} from "./grids";
export type {
  CollectOptions,
  TargetUi,
  ValidationOptions,
  ValidationPoint,
  ValidationResult,
  ValidationSample,
} from "./calibration";
export {
  DEFAULT_FRAME_TIMEOUT_MS,
  runCalibration,
  runValidation,
  withFrameTimeout,
} from "./calibration";

// ---- timing loopback ---------------------------------------------------------
export type {
  CurvePoint,
  Flip,
  IntervalStats,
  LagOptions,
  LagResult,
  LumSample,
  Plateau,
  SplitHalves,
} from "./loopback";
export {
  SECOND_PEAK_MIN_SEPARATION_MS,
  estimateLag,
  estimateLagEdges,
  intervalStats,
  mSequence,
  refineLag,
  seededRandom,
  sparseSchedule,
  splitHalves,
  stimulusAt,
} from "./loopback";
export type { LoopbackOptions, LoopbackResult } from "./loopbackDriver";
export { runLoopback } from "./loopbackDriver";

/** This package's version, as published. */
export const version: string = packageVersion;
