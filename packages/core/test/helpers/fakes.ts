// Stand-ins for the three things jsdom cannot provide: a camera, MediaPipe and WebGPU.

import type { Landmarker } from "../../src/landmarker";
import type { Landmark } from "../../src/types";

/** A landmark set whose eye indices give a well-formed crop box. */
export function fakeLandmarks(): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[226] = { x: 0.3, y: 0.4, z: 0 }; // outer left eye corner
  lm[446] = { x: 0.7, y: 0.4, z: 0 }; // outer right eye corner
  lm[27] = { x: 0.35, y: 0.36, z: 0 };
  lm[257] = { x: 0.65, y: 0.36, z: 0 };
  lm[23] = { x: 0.35, y: 0.44, z: 0 };
  lm[253] = { x: 0.65, y: 0.44, z: 0 };
  return lm;
}

export function fakeLandmarker(found = true): Landmarker {
  const lm = fakeLandmarks();
  return {
    delegate: "CPU",
    detect: () => (found ? lm : null),
    close: () => undefined,
  } as unknown as Landmarker;
}

export interface FrameMeta {
  captureTime?: number;
  receiveTime?: number;
  presentedFrames?: number;
}

export interface FakeVideo {
  el: HTMLVideoElement;
  /** Number of frames delivered so far. */
  count: number;
  stop: () => void;
}

/**
 * A real (jsdom) video element that hands out frames through requestVideoFrameCallback on a
 * timer, with the metadata a Chromium camera would supply.
 */
export function fakeVideo(
  opts: { width?: number; height?: number; period?: number; rvfc?: boolean } = {},
): FakeVideo {
  const width = opts.width ?? 64;
  const height = opts.height ?? 48;
  const period = opts.period ?? 33.3;
  const el = document.createElement("video");
  Object.defineProperty(el, "videoWidth", { value: width, configurable: true });
  Object.defineProperty(el, "videoHeight", { value: height, configurable: true });
  const state: FakeVideo = { el, count: 0, stop: () => undefined };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let handle = 0;
  if (opts.rvfc !== false) {
    (el as any).requestVideoFrameCallback = (cb: (now: number, meta: FrameMeta) => void) => {
      const id = ++handle;
      const t = setTimeout(() => {
        timers.delete(t);
        const n = state.count++;
        const now = 1000 + n * period;
        cb(now, { captureTime: now - 20, receiveTime: now - 5, presentedFrames: n + 1 });
      }, 1);
      timers.add(t);
      return id;
    };
    (el as any).cancelVideoFrameCallback = () => undefined;
  }
  state.stop = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
  return state;
}

/** Poll until `cond` holds, or fail the test after `timeout` ms. */
export async function waitFor(cond: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
