import {
  DEFAULT_FRAME_TIMEOUT_MS,
  runCalibration,
  runValidation,
  withFrameTimeout,
} from "../src/calibration";
import type { TrackerFrame } from "../src/pipeline";
import { SaccadeTracker } from "../src/tracker";
import type { Gaze } from "../src/types";

/**
 * A tracker stand-in: the real one needs a camera. It answers `nextFrame` immediately with a
 * gaze offset from wherever the target currently is, which is what both drivers consume.
 */
function stubTracker(
  offset: Gaze,
  opts: { blind?: boolean } = {},
): {
  tracker: SaccadeTracker;
  setTarget: (t: Gaze | null) => void;
  points: { target: Gaze; embeddings: Float32Array[] }[];
} {
  let target: Gaze | null = null;
  let n = 0;
  const points: { target: Gaze; embeddings: Float32Array[] }[] = [];
  const frame = (): TrackerFrame => {
    n++;
    const e = new Float32Array(128);
    e[0] = n;
    return {
      gaze: target && !opts.blind ? { x: target.x + offset.x, y: target.y + offset.y } : null,
      faceFound: true,
      crop: null,
      embedding: opts.blind ? null : e,
      weight: null,
      meanEmbedding: null,
      timings: { landmark: 0, crop: 0, embed: 0, total: 0 },
      time: {
        capture: n,
        source: "captureTime",
        receive: null,
        presentedFrames: n,
        dropped: 0,
        callback: n,
        emit: n,
        meanCapture: n - 0.5,
      },
      fps: 30,
      error: null,
    };
  };
  const tracker = {
    nextFrame: async () => frame(),
    nextEmbedding: async () => frame().embedding,
    nextSample: async () => {
      const f = frame();
      return f.embedding ? { embedding: f.embedding, weight: f.weight } : null;
    },
    addCalibrationPoint: (t: Gaze, embeddings: Float32Array[]) =>
      points.push({ target: t, embeddings }),
    getCalibrationPoints: () =>
      points.map((p) => ({ ...p, meanEmbedding: p.embeddings[0] })) as any,
  } as unknown as SaccadeTracker;
  return { tracker, setTarget: (t) => (target = t), points };
}

const targets: Gaze[] = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.9 },
];

describe("runCalibration", () => {
  it("shows each target, settles, captures, and adds one point per target", async () => {
    const { tracker, setTarget, points } = stubTracker({ x: 0, y: 0 });
    const shown: string[] = [];
    const out = await runCalibration(
      tracker,
      targets,
      { settleMs: 1, captureMs: 5 },
      {
        showTarget: (t, phase) => {
          setTarget(t);
          shown.push(t ? `${t.x},${t.y}:${phase}` : `null:${phase}`);
        },
      },
    );
    expect(shown.slice(0, 4)).toEqual([
      "0.1,0.1:settle",
      "0.1,0.1:capture",
      "0.9,0.9:settle",
      "0.9,0.9:capture",
    ]);
    expect(shown[shown.length - 1]).toContain("null");
    expect(points).toHaveLength(2);
    expect(points[0].target).toEqual(targets[0]);
    expect(points[0].embeddings.length).toBeGreaterThan(0);
    expect(out).toHaveLength(2);
  });

  it("skips a target that yielded no embeddings", async () => {
    const { tracker, points } = stubTracker({ x: 0, y: 0 }, { blind: true });
    const out = await runCalibration(
      tracker,
      targets,
      { settleMs: 0, captureMs: 3 },
      { showTarget: () => undefined },
    );
    expect(points).toHaveLength(0);
    expect(out).toHaveLength(0);
  });
});

describe("runValidation", () => {
  it("scores the mean gaze per point in both viewport and pixel units", async () => {
    const { tracker, setTarget } = stubTracker({ x: 0.02, y: 0 });
    const res = await runValidation(
      tracker,
      targets,
      {
        settleMs: 1,
        captureMs: 5,
        roiRadiusPx: 100,
        viewport: { width: 1000, height: 500 },
      },
      { showTarget: (t) => setTarget(t) },
    );
    expect(res.points).toHaveLength(2);
    for (const p of res.points) {
      expect(p.samples.length).toBeGreaterThan(0);
      expect(p.meanGaze.x).toBeCloseTo(p.target.x + 0.02, 6);
      expect(p.errorViewport).toBeCloseTo(0.02, 6);
      // 0.02 of a 1000 px viewport is 20 px, comfortably inside a 100 px ROI.
      expect(p.errorPx).toBeCloseTo(20, 6);
      expect(p.percentInRoi).toBe(100);
      // Samples carry the capture time of the frame they came from.
      expect(p.samples[0].time).toBeGreaterThan(0);
    }
    expect(res.medianErrorViewport).toBeCloseTo(0.02, 6);
    expect(res.meanErrorPx).toBeCloseTo(20, 6);
    expect(res.percentInRoi).toBe(100);
  });

  it("counts samples outside the ROI", async () => {
    const { tracker, setTarget } = stubTracker({ x: 0.3, y: 0 });
    const res = await runValidation(
      tracker,
      [targets[0]],
      { settleMs: 0, captureMs: 5, roiRadiusPx: 50, viewport: { width: 1000, height: 500 } },
      { showTarget: (t) => setTarget(t) },
    );
    expect(res.points[0].percentInRoi).toBe(0);
    expect(res.percentInRoi).toBe(0);
  });

  it("reports a point that produced no gaze instead of dropping it", async () => {
    const { tracker } = stubTracker({ x: 0, y: 0 }, { blind: true });
    const res = await runValidation(
      tracker,
      [targets[0]],
      { settleMs: 0, captureMs: 3, roiRadiusPx: 50, viewport: { width: 800, height: 600 } },
      { showTarget: () => undefined },
    );
    expect(res.points).toHaveLength(1);
    expect(res.points[0].samples).toHaveLength(0);
    expect(Number.isNaN(res.points[0].errorViewport)).toBe(true);
    expect(Number.isNaN(res.medianErrorViewport)).toBe(true);
  });
});

/** A tracker whose frame source has died: `nextFrame` is returned but never settles. */
function stalledTracker(): SaccadeTracker {
  const never = () => new Promise<never>(() => undefined);
  return {
    nextFrame: never,
    nextEmbedding: never,
    nextSample: never,
    addCalibrationPoint: () => undefined,
    getCalibrationPoints: () => [],
  } as unknown as SaccadeTracker;
}

describe("the stall guard", () => {
  it("defaults to five seconds", () => {
    expect(DEFAULT_FRAME_TIMEOUT_MS).toBe(5000);
  });

  it("passes a promise that settles in time straight through", async () => {
    await expect(withFrameTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it("names the timeout in the message", async () => {
    await expect(withFrameTimeout(new Promise(() => undefined), 20)).rejects.toThrow(
      "no camera frames for 20 ms",
    );
  });

  it("waits indefinitely when the timeout is 0", async () => {
    const raced = await Promise.race([
      withFrameTimeout(new Promise(() => undefined), 0).then(() => "settled"),
      new Promise((r) => setTimeout(() => r("still waiting"), 30)),
    ]);
    expect(raced).toBe("still waiting");
  });

  it("makes runCalibration reject instead of hanging on a dead frame source", async () => {
    await expect(
      runCalibration(
        stalledTracker(),
        [targets[0]],
        { settleMs: 0, captureMs: 1000, timeoutMs: 20 },
        { showTarget: () => undefined },
      ),
    ).rejects.toThrow(/no camera frames for 20 ms/);
  });

  it("makes runValidation reject instead of hanging on a dead frame source", async () => {
    await expect(
      runValidation(
        stalledTracker(),
        [targets[0]],
        {
          settleMs: 0,
          captureMs: 1000,
          timeoutMs: 20,
          roiRadiusPx: 50,
          viewport: { width: 800, height: 600 },
        },
        { showTarget: () => undefined },
      ),
    ).rejects.toThrow(/no camera frames for 20 ms/);
  });
});
