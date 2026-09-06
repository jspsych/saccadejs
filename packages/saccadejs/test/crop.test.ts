import { readFileSync } from "node:fs";
import { join } from "node:path";

import { clahe, cropBBox, extractEyeCrop, resizeBilinearCv, rgbaToGray } from "../src/crop";
import type { Landmark } from "../src/types";
import { decodePng } from "./helpers/png";

// The fixtures come from the training pipeline's OpenCV (x86 build): every expectation here is
// "byte-identical to cv2", not "close enough". Any drift means the browser sees a different
// image from the one the model was trained on.
const FIX = join(__dirname, "fixtures", "preproc");

function readPng(p: string): { w: number; h: number; rgba: Uint8Array } {
  return decodePng(readFileSync(p));
}

function readGray(p: string): { w: number; h: number; data: Uint8Array } {
  const { w, h, rgba } = readPng(p);
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = rgba[i * 4];
  return { w, h, data };
}

function diff(a: Uint8Array, b: Uint8Array): { max: number; count: number } {
  let max = 0;
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > 0) {
      count++;
      if (d > max) max = d;
    }
  }
  return { max, count };
}

const cases = JSON.parse(readFileSync(join(FIX, "cases.json"), "utf8")) as {
  resize_cases: { name: string; w: number; h: number }[];
  clahe_cases: { name: string; w: number; h: number }[];
  pipeline: {
    W: number;
    H: number;
    landmarks: number[][];
    bbox: { left: number; top: number; right: number; bottom: number };
    crop_w: number;
    crop_h: number;
  };
};

const toLandmarks = (a: number[][]): Landmark[] => a.map(([x, y, z]) => ({ x, y, z }));

describe("resizeBilinearCv", () => {
  for (const c of cases.resize_cases) {
    it(`matches cv2.resize on ${c.name} (${c.w}x${c.h})`, () => {
      const src = readGray(join(FIX, `${c.name}_src.png`));
      const exp = readGray(join(FIX, `${c.name}_resized.png`));
      const got = resizeBilinearCv(src.data, c.w, c.h, 144, 36);
      expect(diff(got, exp.data)).toEqual({ max: 0, count: 0 });
    });
  }
});

describe("clahe", () => {
  for (const c of cases.resize_cases) {
    it(`matches cv2 CLAHE on resized ${c.name}`, () => {
      const src = readGray(join(FIX, `${c.name}_resized.png`));
      const exp = readGray(join(FIX, `${c.name}_clahe.png`));
      const got = clahe(src.data, 144, 36, { clip: 2, tiles: [8, 8] });
      expect(diff(got, exp.data)).toEqual({ max: 0, count: 0 });
    });
  }
  for (const c of cases.clahe_cases) {
    it(`matches cv2 CLAHE on ${c.name}`, () => {
      const src = readGray(join(FIX, `${c.name}_src.png`));
      const exp = readGray(join(FIX, `${c.name}_out.png`));
      const got = clahe(src.data, c.w, c.h, { clip: 2, tiles: [8, 8] });
      expect(diff(got, exp.data)).toEqual({ max: 0, count: 0 });
    });
  }
});

describe("rgbaToGray", () => {
  it("matches cv2.cvtColor BGR2GRAY on the whole frame", () => {
    const frame = readPng(join(FIX, "pipe_frame.png"));
    const exp = readGray(join(FIX, "pipe_frame_gray.png"));
    const got = rgbaToGray(frame.rgba, frame.w, frame.h);
    expect(diff(got, exp.data)).toEqual({ max: 0, count: 0 });
  });
});

describe("cropBBox", () => {
  it("matches the python bbox", () => {
    const p = cases.pipeline;
    const bbox = cropBBox(toLandmarks(p.landmarks), p.W, p.H);
    expect(bbox).toEqual(p.bbox);
  });

  it("rejects empty crops", () => {
    const lm: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    lm[226] = { x: 0.7, y: 0.4, z: 0 };
    lm[446] = { x: 0.3, y: 0.4, z: 0 };
    lm[27] = { x: 0.4, y: 0.4, z: 0 };
    lm[257] = { x: 0.6, y: 0.4, z: 0 };
    lm[23] = { x: 0.4, y: 0.5, z: 0 };
    lm[253] = { x: 0.6, y: 0.5, z: 0 };
    expect(cropBBox(lm, 640, 480)).toBeNull();
  });

  it("clamps out-of-frame bounds instead of wrapping", () => {
    const lm: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    lm[226] = { x: 0.002, y: 0.4, z: 0 };
    lm[446] = { x: 1.02, y: 0.4, z: 0 };
    lm[27] = { x: 0.4, y: 0.005, z: 0 };
    lm[257] = { x: 0.6, y: 0.006, z: 0 };
    lm[23] = { x: 0.4, y: 0.99, z: 0 };
    lm[253] = { x: 0.6, y: 0.995, z: 0 };
    expect(cropBBox(lm, 640, 480)).toEqual({ left: 0, top: 0, right: 640, bottom: 480 });
  });
});

describe("extractEyeCrop", () => {
  it("matches the staged python pipeline", () => {
    const p = cases.pipeline;
    const frame = readPng(join(FIX, "pipe_frame.png"));
    const expGray = readGray(join(FIX, "pipe_crop_gray.png"));
    const expResized = readGray(join(FIX, "pipe_resized.png"));
    const expClahe = readGray(join(FIX, "pipe_clahe.png"));

    const bbox = cropBBox(toLandmarks(p.landmarks), p.W, p.H)!;
    expect(bbox).toEqual(p.bbox);

    const full = rgbaToGray(frame.rgba, frame.w, frame.h);
    const cw = bbox.right - bbox.left;
    const ch = bbox.bottom - bbox.top;
    const gray = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        gray[y * cw + x] = full[(bbox.top + y) * frame.w + bbox.left + x];
      }
    }
    expect(diff(gray, expGray.data)).toEqual({ max: 0, count: 0 });

    const resized = resizeBilinearCv(gray, cw, ch, 144, 36);
    expect(diff(resized, expResized.data)).toEqual({ max: 0, count: 0 });

    const out = extractEyeCrop(frame.rgba, frame.w, frame.h, toLandmarks(p.landmarks))!;
    expect(out.bbox).toEqual(p.bbox);
    expect(out.data.length).toBe(144 * 36);
    expect(diff(out.data, expClahe.data)).toEqual({ max: 0, count: 0 });
  });

  it("returns null when the landmarks give no crop", () => {
    const lm: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    lm[226] = { x: 0.7, y: 0.4, z: 0 }; // right of lm[446]: an inside-out box
    lm[446] = { x: 0.3, y: 0.4, z: 0 };
    const frame = new Uint8Array(64 * 48 * 4);
    expect(extractEyeCrop(frame, 64, 48, lm)).toBeNull();
  });
});
