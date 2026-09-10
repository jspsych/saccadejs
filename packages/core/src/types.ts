/** Height of the model's eye crop, in pixels. */
export const EYE_H = 36;
/** Width of the model's eye crop, in pixels. */
export const EYE_W = 144;
/**
 * Embedding length of the *shipped* model. The library no longer requires it: the ridge fit
 * and the smoothing mean take their width from the embeddings they are handed, so a model of
 * any output length works as long as that length holds. Kept as the reference value for
 * tests, fixtures, and anyone sizing a buffer for the default model.
 */
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
  /** Embedding length the loaded model actually produced, observed at warm-up. */
  dim: number | null;
  /** Whether the graph has the second output that supplies a per-frame quality weight. */
  emitsWeight: boolean;
}

/**
 * Where a ridge fit's weights came from: a second output of the model, a `CalHead` the caller
 * supplied, or nothing at all. Recorded because a weighted fit and an unweighted one are
 * different analyses, and nothing else in the data says which ran.
 */
export type CalWeighting = "model" | "head" | "uniform";

/**
 * One crop, embedded.
 *
 * `weight` is the model's estimate of how usable this frame is, in [0, 1], from a second output
 * of the graph -- null for a model that has none. Returning it with the embedding, rather than
 * fetching it separately, keeps it paired with the embedding it describes.
 */
export interface EmbedResult {
  embedding: Float32Array;
  weight: number | null;
}

/** Anything that turns an eye crop into an embedding. */
export interface EmbeddingModel {
  init(): Promise<{ ep: "webgpu" | "wasm" }>;
  embed(crop: Uint8Array): Promise<EmbedResult>;
  /** Optional: models that load real weights report what they loaded. */
  identity?(): ModelIdentity;
}

/**
 * The one-string form written into experiment data, e.g. `"eye-embedding@1.0.0"` for a
 * verified release, or `"sha256:5a1a111e37f9"` for anything else. Version form implies the
 * bytes hash-matched a published release.
 */
export function formatModelIdentity(id: ModelIdentity | null | undefined): string {
  if (!id) return "unverified";
  if (id.version) return `eye-embedding@${id.version}`;
  if (id.sha256) return `sha256:${id.sha256.slice(0, 12)}`;
  return "unverified";
}

/**
 * One calibration target and the embeddings collected while the subject looked at it.
 *
 * `weights` are the per-frame weights that came back with those embeddings, or null when the
 * model emits none. `meanEmbedding` is already weighted by them, so a low-scoring frame drops
 * out of the mean itself rather than only discounting the finished point.
 */
export interface CalPoint {
  target: Gaze;
  embeddings: Float32Array[];
  weights: number[] | null;
  meanEmbedding: Float32Array;
}

/**
 * A logistic head over the embedding, scoring how usable a crop looks.
 *
 * This is how the first model expressed calibration weighting, and it generalises only to a
 * head of one linear layer. Newer models carry their weighting as a second graph output
 * instead, which leaves the architecture to the model and gives the library a scalar to read.
 * Supplying one of these is an explicit opt-in; the default is no weighting.
 */
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
