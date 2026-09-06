import * as Saccade from "../src/index";
import calWeights from "../src/generated/cal_weights.json";
import manifest from "../src/generated/export_manifest.json";
import { version as packageVersion } from "../package.json";
import { EMB_DIM, EYE_H, EYE_W } from "../src/types";

describe("scaffold", () => {
  it("exposes the crop and embedding dimensions", () => {
    expect(EYE_H * EYE_W).toBe(5184);
    expect(EMB_DIM).toBe(128);
  });

  it("ships a manifest matching the interface contract", () => {
    expect(manifest.model.input.shape).toEqual([1, EYE_H, EYE_W, 1]);
    expect(manifest.model.embedding_dim).toBe(EMB_DIM);
    expect(manifest.model.opset).toBe(17);
    expect(calWeights.kernel).toHaveLength(EMB_DIM);
  });
});

describe("public API", () => {
  it("exports everything the contract names", () => {
    for (const name of [
      "SaccadeTracker",
      "runCalibration",
      "runValidation",
      "runLoopback",
      "defaultGrid13",
      "trainingGrid20",
      "validationGrid9",
      "lambdaFor",
      "sparseSchedule",
      "seededRandom",
      "estimateLagEdges",
      "estimateLag",
      "intervalStats",
      "splitHalves",
      "extractEyeCrop",
      "clahe",
      "resizeBilinearCv",
      "solveRidge",
      "predict",
      "version",
    ]) {
      expect(Saccade).toHaveProperty(name);
    }
  });

  it("reports the package version", () => {
    expect(Saccade.version).toBe(packageVersion);
  });

  it("defaults the assets to the pinned CDN copies", () => {
    expect(Saccade.DEFAULT_ORT_WASM_URL).toContain(`onnxruntime-web@${Saccade.ORT_VERSION}`);
    expect(Saccade.DEFAULT_MEDIAPIPE_WASM_URL).toContain(
      `tasks-vision@${Saccade.MEDIAPIPE_VERSION}`,
    );
    expect(Saccade.DEFAULT_FACE_LANDMARKER_URL).toMatch(/face_landmarker\.task$/);
    // Outside a served @saccadejs/core/dist, the model falls back to this package's CDN copy.
    expect(Saccade.modelUrl()).toBe(
      `https://cdn.jsdelivr.net/npm/@saccadejs/core@${packageVersion}/models/eye_embedding.onnx`,
    );
    expect(Saccade.modelUrl({ modelUrl: "/m.onnx" })).toBe("/m.onnx");
  });
});
