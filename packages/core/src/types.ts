/** Height of the model's eye crop, in pixels. */
export const EYE_H = 36;
/** Width of the model's eye crop, in pixels. */
export const EYE_W = 144;
/** Length of the embedding the model produces for one crop. */
export const EMB_DIM = 128;

/** One MediaPipe face landmark, in normalised image coordinates. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** Pixel bounds of the eye region inside a camera frame. */
export interface BBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A preprocessed eye crop (EYE_W x EYE_H gray, row-major) and where it came from. */
export interface EyeCrop {
  data: Uint8Array;
  bbox: BBox;
}

export type Embedding = Float32Array;

/** A point on the screen as viewport fractions, origin top-left. */
export interface Gaze {
  x: number;
  y: number;
}

/** Anything that turns an eye crop into an embedding. */
export interface EmbeddingModel {
  init(): Promise<{ ep: "webgpu" | "wasm" }>;
  embed(crop: Uint8Array): Promise<Float32Array>;
}

/** One calibration target and the embeddings collected while the subject looked at it. */
export interface CalPoint {
  target: Gaze;
  embeddings: Float32Array[];
  meanEmbedding: Float32Array;
}

/** The shipped logistic head that weights calibration rows by how usable the crop looks. */
export interface CalHead {
  kernel: number[];
  bias: number;
}

/** One weighted row of the ridge system: embedding -> target. */
export interface RidgeRow {
  e: Float32Array;
  x: number;
  y: number;
  w: number;
}
