import type { BBox, EyeCrop, Landmark } from "./types";
import { EYE_H, EYE_W } from "./types";

export interface ClaheOptions {
  clip: number;
  tiles: [number, number];
}

const PADDING = 0.01;

function cvRound(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

function satUchar(v: number): number {
  const r = cvRound(v);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

function satShort(v: number): number {
  return v < -32768 ? -32768 : v > 32767 ? 32767 : v;
}

export function cropBBox(lm: Landmark[], W: number, H: number): BBox | null {
  let left = Math.trunc((lm[226].x - PADDING) * W);
  let right = Math.trunc((lm[446].x + PADDING) * W);
  let top = Math.trunc((Math.min(lm[27].y, lm[257].y) - PADDING) * H);
  let bottom = Math.trunc((Math.max(lm[23].y, lm[253].y) + PADDING) * H);
  if (right - left <= 0 || bottom - top <= 0) return null;
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(W, right);
  bottom = Math.min(H, bottom);
  if (right - left <= 0 || bottom - top <= 0) return null;
  return { left, top, right, bottom };
}

export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, W: number, H: number): Uint8Array {
  const n = W * H;
  const out = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = (rgba[p] * 9798 + rgba[p + 1] * 19235 + rgba[p + 2] * 3735 + 16384) >> 15;
  }
  return out;
}

function grayRegion(
  rgba: Uint8ClampedArray | Uint8Array,
  W: number,
  bbox: BBox,
  out: Uint8Array,
): Uint8Array {
  const cw = bbox.right - bbox.left;
  let o = 0;
  for (let y = bbox.top; y < bbox.bottom; y++) {
    let p = (y * W + bbox.left) * 4;
    for (let x = 0; x < cw; x++, p += 4) {
      out[o++] = (rgba[p] * 9798 + rgba[p + 1] * 19235 + rgba[p + 2] * 3735 + 16384) >> 15;
    }
  }
  return out;
}

function computeLinearCoeffs(
  ssize: number,
  dsize: number,
  ofs: Int32Array,
  alpha: Int32Array,
  clampEdge: boolean,
): void {
  const scale = ssize / dsize;
  for (let d = 0; d < dsize; d++) {
    let f = Math.fround((d + 0.5) * scale - 0.5);
    let s = Math.floor(f);
    f = Math.fround(f - s);
    if (clampEdge) {
      if (s < 0) {
        s = 0;
        f = 0;
      }
      if (s >= ssize - 1) {
        s = ssize - 1;
        f = 0;
      }
    }
    ofs[d] = s;
    alpha[2 * d] = satShort(cvRound(Math.fround(Math.fround(1 - f) * 2048)));
    alpha[2 * d + 1] = satShort(cvRound(Math.fround(f * 2048)));
  }
}

interface ResizeScratch {
  xofs: Int32Array;
  xalpha: Int32Array;
  yofs: Int32Array;
  yalpha: Int32Array;
  row0: Int32Array;
  row1: Int32Array;
  out: Uint8Array;
  sw: number;
  sh: number;
  dw: number;
  dh: number;
}

let resizeScratch: ResizeScratch | null = null;

function getResizeScratch(sw: number, sh: number, dw: number, dh: number): ResizeScratch {
  let s = resizeScratch;
  if (s && s.sw === sw && s.sh === sh && s.dw === dw && s.dh === dh) return s;
  if (!s || s.dw !== dw || s.dh !== dh) {
    s = {
      xofs: new Int32Array(dw),
      xalpha: new Int32Array(dw * 2),
      yofs: new Int32Array(dh),
      yalpha: new Int32Array(dh * 2),
      row0: new Int32Array(dw),
      row1: new Int32Array(dw),
      out: new Uint8Array(dw * dh),
      sw: -1,
      sh: -1,
      dw,
      dh,
    };
    resizeScratch = s;
  }
  if (s.sw !== sw) computeLinearCoeffs(sw, dw, s.xofs, s.xalpha, true);
  if (s.sh !== sh) computeLinearCoeffs(sh, dh, s.yofs, s.yalpha, false);
  s.sw = sw;
  s.sh = sh;
  s.dw = dw;
  s.dh = dh;
  return s;
}

function hResize(
  src: Uint8Array,
  sw: number,
  srow: number,
  dw: number,
  xofs: Int32Array,
  xalpha: Int32Array,
  dst: Int32Array,
): void {
  const base = srow * sw;
  for (let d = 0; d < dw; d++) {
    const sx = xofs[d];
    const a0 = xalpha[2 * d];
    const a1 = xalpha[2 * d + 1];
    dst[d] = sx + 1 < sw ? src[base + sx] * a0 + src[base + sx + 1] * a1 : src[base + sx] * 2048;
  }
}

export function resizeBilinearCv(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8Array {
  const s = getResizeScratch(sw, sh, dw, dh);
  const out = s.out;
  let c0 = -1;
  let c1 = -1;
  let row0 = s.row0;
  let row1 = s.row1;
  for (let dy = 0; dy < dh; dy++) {
    const raw = s.yofs[dy];
    const sy0 = raw < 0 ? 0 : raw > sh - 1 ? sh - 1 : raw;
    const sy1 = raw + 1 < 0 ? 0 : raw + 1 > sh - 1 ? sh - 1 : raw + 1;
    if (c1 === sy0 && c0 !== sy0) {
      const t = row0;
      row0 = row1;
      row1 = t;
      const tc = c0;
      c0 = c1;
      c1 = tc;
    }
    if (c0 !== sy0) {
      hResize(src, sw, sy0, dw, s.xofs, s.xalpha, row0);
      c0 = sy0;
    }
    if (c1 !== sy1) {
      hResize(src, sw, sy1, dw, s.xofs, s.xalpha, row1);
      c1 = sy1;
    }
    const b0 = s.yalpha[2 * dy];
    const b1 = s.yalpha[2 * dy + 1];
    const o = dy * dw;
    for (let x = 0; x < dw; x++) {
      out[o + x] = (((b0 * (row0[x] >> 4)) >> 16) + ((b1 * (row1[x] >> 4)) >> 16) + 2) >> 2;
    }
  }
  return out;
}

function reflect101(i: number, n: number): number {
  if (n === 1) return 0;
  let v = i;
  const p = 2 * n - 2;
  v = ((v % p) + p) % p;
  return v < n ? v : p - v;
}

interface ClaheScratch {
  lut: Uint8Array;
  padded: Uint8Array;
  hist: Int32Array;
  ind1: Int32Array;
  ind2: Int32Array;
  xa: Float32Array;
  xa1: Float32Array;
  out: Uint8Array;
  key: string;
}

let claheScratch: ClaheScratch | null = null;

export function clahe(
  src: Uint8Array,
  w: number,
  h: number,
  opts: ClaheOptions = { clip: 2, tiles: [8, 8] },
): Uint8Array {
  const tilesX = opts.tiles[0];
  const tilesY = opts.tiles[1];
  const padded = w % tilesX !== 0 || h % tilesY !== 0;
  const pw = padded ? w + (tilesX - (w % tilesX)) : w;
  const ph = padded ? h + (tilesY - (h % tilesY)) : h;
  const tw = pw / tilesX;
  const th = ph / tilesY;
  const tileTotal = tw * th;
  const lutScale = Math.fround(255 / tileTotal);
  let clipLimit = 0;
  if (opts.clip > 0) {
    clipLimit = Math.trunc((opts.clip * tileTotal) / 256);
    if (clipLimit < 1) clipLimit = 1;
  }

  const key = `${w}x${h}x${tilesX}x${tilesY}`;
  let s = claheScratch;
  if (!s || s.key !== key) {
    s = {
      lut: new Uint8Array(tilesX * tilesY * 256),
      padded: new Uint8Array(pw * ph),
      hist: new Int32Array(256),
      ind1: new Int32Array(w),
      ind2: new Int32Array(w),
      xa: new Float32Array(w),
      xa1: new Float32Array(w),
      out: new Uint8Array(w * h),
      key,
    };
    const invTw = Math.fround(1 / tw);
    for (let x = 0; x < w; x++) {
      const txf = Math.fround(Math.fround(x * invTw) - 0.5);
      let tx1 = Math.floor(txf);
      let tx2 = tx1 + 1;
      s.xa[x] = Math.fround(txf - tx1);
      s.xa1[x] = Math.fround(1 - s.xa[x]);
      if (tx1 < 0) tx1 = 0;
      if (tx2 > tilesX - 1) tx2 = tilesX - 1;
      s.ind1[x] = tx1 * 256;
      s.ind2[x] = tx2 * 256;
    }
    claheScratch = s;
  }

  let lutSrc: Uint8Array;
  let lw: number;
  if (padded) {
    lutSrc = s.padded;
    lw = pw;
    for (let y = 0; y < ph; y++) {
      const sy = y < h ? y : reflect101(y, h);
      const so = sy * w;
      const doff = y * pw;
      for (let x = 0; x < pw; x++) {
        lutSrc[doff + x] = src[so + (x < w ? x : reflect101(x, w))];
      }
    }
  } else {
    lutSrc = src;
    lw = w;
  }

  const hist = s.hist;
  const lut = s.lut;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      hist.fill(0);
      const x0 = tx * tw;
      const y0 = ty * th;
      for (let y = 0; y < th; y++) {
        const o = (y0 + y) * lw + x0;
        for (let x = 0; x < tw; x++) hist[lutSrc[o + x]]++;
      }
      if (clipLimit > 0) {
        let clipped = 0;
        for (let i = 0; i < 256; i++) {
          if (hist[i] > clipLimit) {
            clipped += hist[i] - clipLimit;
            hist[i] = clipLimit;
          }
        }
        const redistBatch = Math.trunc(clipped / 256);
        let residual = clipped - redistBatch * 256;
        for (let i = 0; i < 256; i++) hist[i] += redistBatch;
        if (residual !== 0) {
          const step = Math.max(Math.trunc(256 / residual), 1);
          for (let i = 0; i < 256 && residual > 0; i += step, residual--) {
            hist[i]++;
          }
        }
      }
      let sum = 0;
      const lo = (ty * tilesX + tx) * 256;
      for (let i = 0; i < 256; i++) {
        sum += hist[i];
        lut[lo + i] = satUchar(Math.fround(sum * lutScale));
      }
    }
  }

  const out = s.out;
  const invTh = Math.fround(1 / th);
  for (let y = 0; y < h; y++) {
    const tyf = Math.fround(Math.fround(y * invTh) - 0.5);
    let ty1 = Math.floor(tyf);
    let ty2 = ty1 + 1;
    const ya = Math.fround(tyf - ty1);
    const ya1 = Math.fround(1 - ya);
    if (ty1 < 0) ty1 = 0;
    if (ty2 > tilesY - 1) ty2 = tilesY - 1;
    const p1 = ty1 * tilesX * 256;
    const p2 = ty2 * tilesX * 256;
    const so = y * w;
    for (let x = 0; x < w; x++) {
      const v = src[so + x];
      const i1 = s.ind1[x] + v;
      const i2 = s.ind2[x] + v;
      const xa = s.xa[x];
      const xa1 = s.xa1[x];
      const r1 = Math.fround(Math.fround(lut[p1 + i1] * xa1) + Math.fround(lut[p1 + i2] * xa));
      const r2 = Math.fround(Math.fround(lut[p2 + i1] * xa1) + Math.fround(lut[p2 + i2] * xa));
      out[so + x] = satUchar(Math.fround(Math.fround(r1 * ya1) + Math.fround(r2 * ya)));
    }
  }
  return out;
}

let cropScratch: Uint8Array | null = null;

export function extractEyeCrop(
  frameRGBA: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  lm: Landmark[],
): EyeCrop | null {
  const bbox = cropBBox(lm, W, H);
  if (!bbox) return null;
  const cw = bbox.right - bbox.left;
  const ch = bbox.bottom - bbox.top;
  const need = cw * ch;
  if (!cropScratch || cropScratch.length < need) cropScratch = new Uint8Array(need);
  const gray = grayRegion(frameRGBA, W, bbox, cropScratch);
  const resized = resizeBilinearCv(gray, cw, ch, EYE_W, EYE_H);
  const eq = clahe(resized, EYE_W, EYE_H, { clip: 2, tiles: [8, 8] });
  return { data: new Uint8Array(eq), bbox };
}
