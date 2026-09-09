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
/**
 * What model actually ran, established from the bytes that were loaded rather than from the
 * URL or filename they came from.
 *
 * `sha256` is computed over the fetched `.onnx`. When it matches a release in the package's
 * `models/releases.json`, `version` and `contract` are filled in and `resolvedFrom` is
 * `"registry"` -- so a version here *means the bytes were verified*, not that a path looked
 * right. An unrecognised model (your own weights, a fine-tune) is reported honestly as
 * `"hash-only"` with `version: null`.
 */
export interface ModelIdentity {
  /** Lowercase hex sha256 of the loaded model, or null if the hash could not be computed. */
  sha256: string | null;
  /** Published version, when the hash matched a known release. */
  version: string | null;
  /** Preprocessing contract of the matched release. */
  contract: number | null;
  /** Where the bytes were fetched from. */
  url: string | null;
  resolvedFrom: "registry" | "hash-only" | "unverified";
}

export interface EmbeddingModel {
  init(): Promise<{ ep: "webgpu" | "wasm" }>;
  embed(crop: Uint8Array): Promise<Float32Array>;
  /** Optional: models that load real weights report what they loaded. */
  identity?(): ModelIdentity;
}

/**
 * The one-string form written into experiment data, e.g. `"eye-embedding@1.0.0"` for a
 * verified release, or `"sha256:c323131f7660"` for anything else. Version form implies the
 * bytes hash-matched a published release.
 */
export function formatModelIdentity(id: ModelIdentity | null | undefined): string {
  if (!id) return "unverified";
  if (id.version) return `eye-embedding@${id.version}`;
  if (id.sha256) return `sha256:${id.sha256.slice(0, 12)}`;
  return "unverified";
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
