import { presetModules, resetModules } from "../src/assets";
import { CENTER, defaultGrid13, trainingGrid20, validationGrid9 } from "../src/grids";
import { StubEmbeddingModel } from "../src/model";
import { SaccadeTracker } from "../src/tracker";
import type { Gaze } from "../src/types";
import { fakeLandmarks, waitFor } from "./helpers/fakes";

/** A @mediapipe/tasks-vision stand-in: the FaceLandmarker always finds the same face. */
function fakeVision(): any {
  const lm = fakeLandmarks();
  return {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    FaceLandmarker: {
      createFromOptions: async () => ({
        detectForVideo: () => ({ faceLandmarks: [lm] }),
        close: () => undefined,
      }),
    },
  };
}

/** A MediaStream stand-in; only getTracks() is ever called. */
function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: () => undefined }] } as unknown as MediaStream;
}

function embedding(seed: number): Float32Array {
  const e = new Float32Array(128);
  for (let i = 0; i < 128; i++) e[i] = Math.sin(seed * 0.7 + i * 0.13);
  return e;
}

describe("SaccadeTracker", () => {
  afterEach(() => resetModules());

  it("creates an unmirrored video element up front", () => {
    const t = new SaccadeTracker();
    expect(t.video.tagName).toBe("VIDEO");
    expect(t.video.muted).toBe(true);
    expect(t.video.style.transform).toBe("");
    expect(t.running).toBe(false);
    expect(t.calibrated).toBe(false);
    expect(t.getCurrentGaze()).toBeNull();
  });

  it("accumulates calibration points and fits a kernel from them", () => {
    const t = new SaccadeTracker();
    const targets = defaultGrid13();
    targets.forEach((target, i) =>
      t.addCalibrationPoint(target, [embedding(i), embedding(i + 0.5)]),
    );
    expect(t.getCalibrationPoints()).toHaveLength(13);
    // The stored mean is the mean of the embeddings handed in.
    const p = t.getCalibrationPoints()[0];
    expect(p.meanEmbedding[0]).toBeCloseTo((embedding(0)[0] + embedding(0.5)[0]) / 2, 6);

    const fit = t.fitCalibration();
    expect(fit).toEqual({ lambda: 1, nPoints: 13, weighting: "uniform" });
    expect(t.calibrated).toBe(true);
    expect(t.getKernel()!.length).toBe(256);

    // Nine points or fewer get the heavier penalty.
    const t9 = new SaccadeTracker();
    validationGrid9().forEach((target, i) => t9.addCalibrationPoint(target, [embedding(i)]));
    expect(t9.fitCalibration()!.lambda).toBe(3);
    expect(t9.fitCalibration({ lambda: 0.25 })!.lambda).toBe(0.25);

    t.clearCalibration();
    expect(t.calibrated).toBe(false);
    expect(t.getCalibrationPoints()).toHaveLength(0);
    expect(new SaccadeTracker().fitCalibration()).toBeNull();
  });

  it("ignores a calibration point with no embeddings", () => {
    const t = new SaccadeTracker();
    t.addCalibrationPoint({ x: 0.5, y: 0.5 }, []);
    expect(t.getCalibrationPoints()).toHaveLength(0);
  });

  it("clamps smoothingFrames to at least one frame", () => {
    const t = new SaccadeTracker({ smoothingFrames: 7 });
    expect(t.getSmoothingFrames()).toBe(7);
    t.setSmoothingFrames(0);
    expect(t.getSmoothingFrames()).toBe(1);
    t.setSmoothingFrames(2.4);
    expect(t.getSmoothingFrames()).toBe(2);
  });

  it("initialises against a supplied stream and model, then tracks", async () => {
    presetModules(undefined, fakeVision());
    const t = new SaccadeTracker({
      stream: fakeStream(),
      model: new StubEmbeddingModel(),
      smoothingFrames: 2,
    });
    // jsdom's HTMLMediaElement.play() is "not implemented" and only prints noise.
    t.video.play = async () => undefined;
    Object.defineProperty(t.video, "videoWidth", { value: 64, configurable: true });
    Object.defineProperty(t.video, "videoHeight", { value: 48, configurable: true });

    const res = await t.init();
    expect(res).toEqual({ ep: "wasm", videoWidth: 64, videoHeight: 48 });
    // Idempotent: the second call resolves with the same result without re-asking.
    expect(await t.init()).toEqual(res);

    const seen: number[] = [];
    const off = t.onFrame((f) => seen.push(f.time.capture));
    t.start();
    expect(t.running).toBe(true);
    const frame = await t.nextFrame();
    expect(frame.embedding!.length).toBe(128);
    await waitFor(() => seen.length >= 2);
    off();
    const n = seen.length;
    await t.nextFrame();
    expect(seen.length).toBe(n);

    // With a kernel in place the frames carry gaze, and getCurrentGaze follows them.
    t.addCalibrationPoint({ x: 0.5, y: 0.5 }, [embedding(1)]);
    t.fitCalibration({ lambda: 1e6 }); // huge penalty -> kernel ~ 0 -> prediction at CENTER
    await waitFor(() => t.getCurrentGaze() !== null);
    const cur = t.getCurrentGaze()!;
    expect(cur.gaze.x).toBeCloseTo(CENTER, 3);
    expect(cur.time.source).toBe("callback");

    t.stop();
    expect(t.running).toBe(false);
    t.dispose();
    expect(t.video.srcObject).toBeNull();
  }, 15000);

  it("keeps its video in the document, and puts it back if it is detached", () => {
    const t = new SaccadeTracker();
    expect(t.video.isConnected).toBe(false);

    t.start();
    // Rendered but invisible: Chrome only delivers camera frames for a rendered video, so the
    // holder must not use display:none or visibility:hidden.
    const holder = t.video.parentElement!;
    expect(holder.isConnected).toBe(true);
    expect(holder.hasAttribute("data-saccade-video-holder")).toBe(true);
    expect(holder.style.display).not.toBe("none");
    expect(holder.style.visibility).not.toBe("hidden");
    expect(holder.style.opacity).toBe("0");

    // A host is free to move it into its own container.
    const mine = document.createElement("div");
    document.body.appendChild(mine);
    mine.appendChild(t.video);
    t.start();
    expect(t.video.parentElement).toBe(mine);

    // But if that container goes away, the tracker takes the video back.
    mine.remove();
    expect(t.video.isConnected).toBe(false);
    t.start();
    expect(t.video.parentElement).toBe(holder);

    t.dispose();
    expect(holder.isConnected).toBe(false);
  });

  it("hands out the grids the contract names", () => {
    expect(defaultGrid13()).toHaveLength(13);
    expect(trainingGrid20()).toHaveLength(20);
    expect(validationGrid9()).toHaveLength(9);
    const inRange = (g: Gaze): boolean => g.x >= 0 && g.x <= 1 && g.y >= 0 && g.y <= 1;
    expect([...defaultGrid13(), ...trainingGrid20(), ...validationGrid9()].every(inRange)).toBe(
      true,
    );
  });
});
