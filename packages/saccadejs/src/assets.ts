// Where the heavy things come from.
//
// Two runtimes have to work from one source file:
//
//   * bundler ESM (`dist/index.js`) — `onnxruntime-web` and `@mediapipe/tasks-vision` are
//     ordinary dependencies, so the bare dynamic `import()`s below resolve and the bundler
//     code-splits them.
//   * plain `<script>` (`dist/index.browser.min.js`) — those two packages are *not* bundled
//     (rollup.config.mjs marks them external for the iife builds), so the bare specifier
//     cannot resolve in a browser; the rejected import falls through to a jsdelivr URL.
//
// Everything is overridable through `SaccadeAssets` for labs that must self-host.

import type * as MpNS from "@mediapipe/tasks-vision";
import type * as OrtNS from "onnxruntime-web";

import { moduleUrl } from "./importMeta";
import { version } from "../package.json";

/**
 * Pinned to the versions in this package's `dependencies` (`onnxruntime-web` 1.29.0,
 * `@mediapipe/tasks-vision` 0.10.35). Bump both together with package.json: the CDN copy has
 * to be the same build the ESM path would have bundled.
 */
export const ORT_VERSION = "1.29.0";
export const MEDIAPIPE_VERSION = "0.10.35";

const JSDELIVR = "https://cdn.jsdelivr.net/npm";

/** onnxruntime-web's `dist/`, which holds both the .mjs loaders and the .wasm binaries. */
export const DEFAULT_ORT_WASM_URL = `${JSDELIVR}/onnxruntime-web@${ORT_VERSION}/dist/`;
/** Same entry point a bundler picks for `import "onnxruntime-web"`. */
const DEFAULT_ORT_MODULE = "ort.bundle.min.mjs";
export const DEFAULT_MEDIAPIPE_WASM_URL = `${JSDELIVR}/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const DEFAULT_MEDIAPIPE_MODULE_URL = `${JSDELIVR}/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
export const DEFAULT_FACE_LANDMARKER_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

export interface SaccadeAssets {
  /**
   * URL of `eye_embedding.onnx`. Default: resolved relative to this package when it is being
   * served from a `saccadejs` `dist/`, else the jsdelivr copy of this exact version.
   */
  modelUrl?: string;
  /** Directory URL for onnxruntime-web's .wasm/.mjs. Default: jsdelivr `onnxruntime-web@<pinned>/dist/`. */
  ortWasmUrl?: string;
  /** Directory URL for @mediapipe/tasks-vision's wasm. Default: jsdelivr `tasks-vision@<pinned>/wasm`. */
  mediapipeWasmUrl?: string;
  /** URL of `face_landmarker.task`. Default: Google's hosted float16 model. */
  faceLandmarkerUrl?: string;
  /**
   * Extension to the published contract: explicit ESM URL for onnxruntime-web. Only consulted
   * by the `<script>`-tag build, which cannot resolve the bare specifier. Default: the
   * `ort.bundle.min.mjs` inside `ortWasmUrl`.
   */
  ortModuleUrl?: string;
  /** Extension: explicit ESM URL for @mediapipe/tasks-vision. Default: the pinned jsdelivr bundle. */
  mediapipeModuleUrl?: string;
}

function withSlash(dir: string): string {
  return dir.endsWith("/") ? dir : `${dir}/`;
}

export function ortWasmUrl(assets: SaccadeAssets = {}): string {
  return withSlash(assets.ortWasmUrl ?? DEFAULT_ORT_WASM_URL);
}

export function mediapipeWasmUrl(assets: SaccadeAssets = {}): string {
  return assets.mediapipeWasmUrl ?? DEFAULT_MEDIAPIPE_WASM_URL;
}

export function faceLandmarkerUrl(assets: SaccadeAssets = {}): string {
  return assets.faceLandmarkerUrl ?? DEFAULT_FACE_LANDMARKER_URL;
}

/**
 * The .onnx that sits next to the running build, when there is one: `.../saccadejs/dist/x.js`
 * (or `.../saccadejs@1.2.3/dist/x.js` on a CDN) puts the model at `../models/`. Returns null
 * everywhere else — inside someone's app bundle the module URL says nothing about us.
 */
export function packageModelUrl(): string | null {
  const here = moduleUrl();
  if (!here) return null;
  const m = /^(.*\/saccadejs(?:@[^/]*)?)\/dist\/[^/]*$/.exec(here);
  return m ? `${m[1]}/models/eye_embedding.onnx` : null;
}

export function modelUrl(assets: SaccadeAssets = {}): string {
  if (assets.modelUrl) return assets.modelUrl;
  return packageModelUrl() ?? `${JSDELIVR}/saccadejs@${version}/models/eye_embedding.onnx`;
}

let ortPromise: Promise<typeof OrtNS> | null = null;
let visionPromise: Promise<typeof MpNS> | null = null;

/**
 * Load onnxruntime-web and point it at its wasm. The module is cached: ORT keeps global
 * state (`env.wasm`), so loading it twice in one page would be a bug rather than a cost.
 */
export async function loadOrt(assets: SaccadeAssets = {}): Promise<typeof OrtNS> {
  if (!ortPromise) {
    const url = assets.ortModuleUrl ?? `${ortWasmUrl(assets)}${DEFAULT_ORT_MODULE}`;
    ortPromise = (async () => {
      const ort = assets.ortModuleUrl ? await importUrl<typeof OrtNS>(url) : await importOrt(url);
      // "bundle" builds inline the loader .mjs, so this only has to find the .wasm; giving a
      // directory rather than a file map keeps self-hosting a one-liner.
      ort.env.wasm.wasmPaths = ortWasmUrl(assets);
      ort.env.wasm.numThreads = 1;
      return ort;
    })();
    ortPromise.catch(() => {
      ortPromise = null;
    });
  }
  return ortPromise;
}

/** Load @mediapipe/tasks-vision (cached for the same reason). */
export async function loadVision(assets: SaccadeAssets = {}): Promise<typeof MpNS> {
  if (!visionPromise) {
    const url = assets.mediapipeModuleUrl ?? DEFAULT_MEDIAPIPE_MODULE_URL;
    visionPromise = assets.mediapipeModuleUrl ? importUrl<typeof MpNS>(url) : importVision(url);
    visionPromise.catch(() => {
      visionPromise = null;
    });
  }
  return visionPromise;
}

/** Test/AOT seam: hand in already-loaded modules instead of fetching them. */
export function presetModules(ort?: typeof OrtNS, vision?: typeof MpNS): void {
  if (ort) ortPromise = Promise.resolve(ort);
  if (vision) visionPromise = Promise.resolve(vision);
}

/** Forget the cached modules (tests only). */
export function resetModules(): void {
  ortPromise = null;
  visionPromise = null;
}

// The two literal-specifier imports below are what a bundler resolves. In the `<script>` build
// they are external, so the specifier reaches the browser unresolved and rejects; the URL
// import is the real path there. Keep them as separate literal call sites — a variable
// specifier would be invisible to bundlers and break the ESM story.

async function importOrt(url: string): Promise<typeof OrtNS> {
  try {
    return (await import("onnxruntime-web")) as unknown as typeof OrtNS;
  } catch {
    return importUrl<typeof OrtNS>(url);
  }
}

async function importVision(url: string): Promise<typeof MpNS> {
  try {
    return (await import("@mediapipe/tasks-vision")) as unknown as typeof MpNS;
  } catch {
    return importUrl<typeof MpNS>(url);
  }
}

function importUrl<T>(url: string): Promise<T> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<T>;
}
