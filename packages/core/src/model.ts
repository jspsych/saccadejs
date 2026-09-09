import type * as OrtNS from "onnxruntime-web";

import type { SaccadeAssets } from "./assets";
import { fetchModelBytes, loadOrt, modelUrl } from "./assets";
import manifest from "./generated/export_manifest.json";
import type { SaccadeProgressCallback } from "./progress";
import { reportProgress } from "./progress";
import type { EmbeddingModel, ModelIdentity } from "./types";
import releases from "../models/releases.json";
import { EMB_DIM, EYE_H, EYE_W } from "./types";

export interface OrtModelOptions {
  assets?: SaccadeAssets;
  executionProviders?: ("webgpu" | "wasm")[];
  /** Load progress: the `ort`, `model` (with byte counts) and `session` stages. */
  onProgress?: SaccadeProgressCallback;
}

const CROP_LEN = EYE_H * EYE_W;

/**
 * sha256 of the loaded model, as lowercase hex.
 *
 * `crypto.subtle` needs a secure context -- but so does `getUserMedia`, so any page that can
 * reach a camera can also hash. The null path is therefore unreachable in a working
 * experiment; it exists so a test double or an odd embedding host degrades instead of
 * throwing.
 */
async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const view = new Uint8Array(bytes); // a fresh, non-shared buffer for digest()
    const digest = await subtle.digest("SHA-256", view);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Look a hash up in the shipped registry: the hash is the identity, the registry names it. */
function identify(sha256: string | null, url: string): ModelIdentity {
  if (!sha256)
    return { sha256: null, version: null, contract: null, url, resolvedFrom: "unverified" };
  const known = releases.releases.find((r) => r.sha256 === sha256);
  return {
    sha256,
    version: known?.version ?? null,
    contract: known?.contract ?? null,
    url,
    resolvedFrom: known ? "registry" : "hash-only",
  };
}

const manifestIo = manifest as unknown as {
  model?: { input?: { name?: string }; output?: { name?: string } };
  input_name?: string;
  output_name?: string;
};
const INPUT_NAME = manifestIo.model?.input?.name ?? manifestIo.input_name ?? "eye_image";
const OUTPUT_NAME = manifestIo.model?.output?.name ?? manifestIo.output_name ?? "embedding";

/** The eye-embedding model on ONNX Runtime Web: WebGPU when it works, wasm otherwise. */
export class OrtEmbeddingModel implements EmbeddingModel {
  readonly modelPath: string;
  private assets: SaccadeAssets;
  private eps: ("webgpu" | "wasm")[];
  private capture = false;
  private session: OrtNS.InferenceSession | null = null;
  private input!: OrtNS.Tensor;
  private inputData!: Float32Array;
  private inputName = INPUT_NAME;
  private outputName = OUTPUT_NAME;
  private ep: "webgpu" | "wasm" = "wasm";
  private modelIdentity: ModelIdentity | null = null;
  private onProgress?: SaccadeProgressCallback;

  constructor(opts: OrtModelOptions = {}) {
    this.assets = opts.assets ?? {};
    this.modelPath = modelUrl(this.assets);
    this.eps = opts.executionProviders ?? ["webgpu", "wasm"];
    this.onProgress = opts.onProgress;
  }

  /** True when the WebGPU session was created with (and survived) graph capture. */
  get graphCapture(): boolean {
    return this.capture;
  }

  /** Which execution provider the live session runs on. */
  get provider(): "webgpu" | "wasm" {
    return this.ep;
  }

  async init(): Promise<{ ep: "webgpu" | "wasm" }> {
    reportProgress(this.onProgress, { stage: "ort" });
    const ort = await loadOrt(this.assets);

    this.inputData = new Float32Array(CROP_LEN);
    this.input = new ort.Tensor("float32", this.inputData, [1, EYE_H, EYE_W, 1]);

    // Fetched once, up front, and reused for every provider attempt below.
    reportProgress(this.onProgress, { stage: "model", loaded: 0 });
    const bytes = await fetchModelBytes(this.modelPath, (loaded, total) =>
      reportProgress(this.onProgress, { stage: "model", loaded, total }),
    );

    // The bytes are already contiguous in memory for the progress reporting above, so this
    // costs one pass over ~20 MB, once, off the main thread.
    this.modelIdentity = identify(await sha256Hex(bytes), this.modelPath);

    reportProgress(this.onProgress, { stage: "session" });
    let lastErr: unknown = null;
    for (const ep of this.eps) {
      // Graph capture in ORT-web requires every input/output to be a pre-allocated
      // 'gpu-buffer' tensor; with a CPU input it throws at the first run(), so the warm-up is
      // what decides whether it stays on.
      for (const capture of ep === "webgpu" ? [true, false] : [false]) {
        try {
          this.session = await ort.InferenceSession.create(bytes, {
            executionProviders: [ep],
            graphOptimizationLevel: "all",
            ...(capture ? { enableGraphCapture: true } : {}),
          });
          this.bindNames();
          await this.embed(new Uint8Array(CROP_LEN));
          this.ep = ep;
          this.capture = capture;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          this.session?.release();
          this.session = null;
        }
      }
      if (this.session) break;
    }
    if (!this.session) throw lastErr ?? new Error("no execution provider available");
    return { ep: this.ep };
  }

  /** What actually loaded. Available after `init()`; null before it. */
  identity(): ModelIdentity {
    return (
      this.modelIdentity ?? {
        sha256: null,
        version: null,
        contract: null,
        url: this.modelPath,
        resolvedFrom: "unverified",
      }
    );
  }

  private bindNames(): void {
    if (!this.session) return;
    const names = this.session.inputNames;
    if (names.length > 0 && !names.includes(this.inputName)) this.inputName = names[0];
    const outs = this.session.outputNames;
    if (outs.length > 0 && !outs.includes(this.outputName)) this.outputName = outs[0];
  }

  async embed(crop: Uint8Array): Promise<Float32Array> {
    if (!this.session) throw new Error("model not initialized");
    if (crop.length !== CROP_LEN) throw new Error(`crop length ${crop.length} != ${CROP_LEN}`);
    for (let i = 0; i < CROP_LEN; i++) this.inputData[i] = crop[i];
    const out = await this.session.run({ [this.inputName]: this.input });
    const t = out[this.outputName];
    return Float32Array.from(t.data as Float32Array);
  }

  dispose(): void {
    this.session?.release();
    this.session = null;
  }
}

/**
 * A deterministic stand-in for the real model: block means of the crop through a fixed random
 * projection. Gaze from it is meaningless — it exists so the pipeline can be exercised in
 * tests and on machines where the .onnx will not load.
 */
export class StubEmbeddingModel implements EmbeddingModel {
  private static readonly BLOCKS_X = 16;
  private static readonly BLOCKS_Y = 4;
  private weights: Float32Array;

  constructor() {
    const nb = StubEmbeddingModel.BLOCKS_X * StubEmbeddingModel.BLOCKS_Y;
    this.weights = new Float32Array(EMB_DIM * nb);
    let s = 0x9e3779b9;
    for (let i = 0; i < this.weights.length; i++) {
      s = (Math.imul(s ^ (s >>> 15), 0x85ebca6b) + 0x165667b1) >>> 0;
      this.weights[i] = (s / 0xffffffff) * 2 - 1;
    }
  }

  init(): Promise<{ ep: "webgpu" | "wasm" }> {
    return Promise.resolve({ ep: "wasm" });
  }

  embed(crop: Uint8Array): Promise<Float32Array> {
    const bx = StubEmbeddingModel.BLOCKS_X;
    const by = StubEmbeddingModel.BLOCKS_Y;
    const nb = bx * by;
    const means = new Float32Array(nb);
    const bw = EYE_W / bx;
    const bh = EYE_H / by;
    for (let y = 0; y < EYE_H; y++) {
      const yb = Math.min(by - 1, Math.floor(y / bh));
      for (let x = 0; x < EYE_W; x++) {
        const xb = Math.min(bx - 1, Math.floor(x / bw));
        means[yb * bx + xb] += crop[y * EYE_W + x];
      }
    }
    const perBlock = (EYE_W * EYE_H) / nb;
    for (let i = 0; i < nb; i++) means[i] = means[i] / perBlock / 255 - 0.5;

    const out = new Float32Array(EMB_DIM);
    for (let j = 0; j < EMB_DIM; j++) {
      let acc = 0;
      for (let i = 0; i < nb; i++) acc += this.weights[j * nb + i] * means[i];
      out[j] = Math.tanh(acc);
    }
    return Promise.resolve(out);
  }
}
