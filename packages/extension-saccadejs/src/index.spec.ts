import { JsPsych } from "jspsych";

import SaccadeExtension from ".";
import { SaccadeTracker, makeFrame } from "./test-stubs/saccadejs";

/** A minimal jsPsych double: the extension only ever calls `getDisplayElement()`. */
function makeJsPsych(display: HTMLElement) {
  return { getDisplayElement: () => display } as unknown as JsPsych;
}

async function makeExtension(
  display: HTMLElement,
  params: Record<string, any> = {},
): Promise<{ extension: SaccadeExtension; tracker: SaccadeTracker }> {
  const tracker = new SaccadeTracker();
  const extension = new SaccadeExtension(makeJsPsych(display));
  await extension.initialize({ tracker: tracker as any, ...params });
  return { extension, tracker };
}

describe("SaccadeExtension.info", () => {
  it("is a well-formed extension info block", () => {
    expect(SaccadeExtension.info.name).toBe("saccade");
    expect(typeof SaccadeExtension.info.version).toBe("string");
    expect(Object.keys(SaccadeExtension.info.data).sort()).toEqual([
      "saccade_data",
      "saccade_targets",
      "saccade_timing",
    ]);
  });
});

describe("SaccadeExtension lifecycle", () => {
  let display: HTMLElement;

  beforeEach(() => {
    display = document.createElement("div");
    document.body.appendChild(display);
    SaccadeTracker.instances.length = 0;
  });

  afterEach(() => {
    display.remove();
    jest.restoreAllMocks();
  });

  it("returns the three documented data fields from on_finish", async () => {
    const { extension, tracker } = await makeExtension(display);

    extension.on_start({ targets: [] });
    extension.on_load();
    tracker.emit(makeFrame({ time: { capture: performance.now() } as any }));
    const data = extension.on_finish();

    expect(Object.keys(data).sort()).toEqual(["saccade_data", "saccade_targets", "saccade_timing"]);
    expect(Array.isArray(data.saccade_data)).toBe(true);
    expect(Object.keys(data.saccade_data[0]).sort()).toEqual(["t", "x", "y"]);
    expect(data.saccade_targets).toEqual({});
    expect(data.saccade_timing).toEqual({
      offset_ms: null,
      corrected: false,
      clock: "captureTime",
      dropped_frames: 0,
      fps: 30,
      tta: 5,
    });
  });

  it("records one row per frame, in viewport pixels, rounded by default", async () => {
    const { extension, tracker } = await makeExtension(display);
    extension.on_start({ targets: [] });
    extension.on_load();

    tracker.emit(makeFrame({ gaze: { x: 0.25, y: 0.5 } }));
    tracker.emit(makeFrame({ gaze: { x: 0.75, y: 0.5 } }));
    // no face -> no row
    tracker.emit(makeFrame({ faceFound: false, gaze: null }));

    const { saccade_data } = extension.on_finish();
    expect(saccade_data).toHaveLength(2);
    expect(saccade_data[0].x).toBe(Math.round(0.25 * window.innerWidth));
    expect(saccade_data[0].y).toBe(Math.round(0.5 * window.innerHeight));
    expect(Number.isInteger(saccade_data[1].x)).toBe(true);
  });

  it("does not round when round_predictions is false", async () => {
    const { extension, tracker } = await makeExtension(display, { round_predictions: false });
    extension.on_start({ targets: [] });
    extension.on_load();
    tracker.emit(makeFrame({ gaze: { x: 0.3333, y: 0.5 } }));

    const { saccade_data } = extension.on_finish();
    expect(saccade_data[0].x).toBeCloseTo(0.3333 * window.innerWidth, 6);
  });

  it("subtracts the trial start time from t", async () => {
    jest.spyOn(performance, "now").mockReturnValue(1000);
    const { extension, tracker } = await makeExtension(display);
    extension.on_start({ targets: [] });
    extension.on_load(); // trial starts at t = 1000

    tracker.emit(makeFrame({ time: { capture: 1100 } as any }));
    const { saccade_data } = extension.on_finish();
    expect(saccade_data[0].t).toBe(100);
  });

  it("times a sample by the TTA window's mean capture, not the newest frame", async () => {
    jest.spyOn(performance, "now").mockReturnValue(1000);
    const { extension, tracker } = await makeExtension(display);
    extension.on_start({ targets: [] });
    extension.on_load();

    // newest frame captured at 1200, but the smoothed gaze refers to 1100
    tracker.emit(makeFrame({ time: { capture: 1200, meanCapture: 1100 } as any }));
    expect(extension.on_finish().saccade_data[0].t).toBe(100);
  });

  it("falls back to the frame's own capture time when there is no TTA mean", async () => {
    jest.spyOn(performance, "now").mockReturnValue(1000);
    const { extension, tracker } = await makeExtension(display);
    extension.on_start({ targets: [] });
    extension.on_load();

    tracker.emit(makeFrame({ time: { capture: 1200, meanCapture: null } as any }));
    expect(extension.on_finish().saccade_data[0].t).toBe(200);
  });

  it("also subtracts the timing offset from t once one is set", async () => {
    jest.spyOn(performance, "now").mockReturnValue(1000);
    const { extension, tracker } = await makeExtension(display);
    extension.setTimingOffset(25);

    extension.on_start({ targets: [] });
    extension.on_load();
    tracker.emit(makeFrame({ time: { capture: 1100 } as any }));

    const data = extension.on_finish();
    expect(data.saccade_data[0].t).toBe(75);
    expect(data.saccade_timing.offset_ms).toBe(25);
    expect(data.saccade_timing.corrected).toBe(true);
  });

  it("records the bounding rectangle of each requested target", async () => {
    display.innerHTML = `<div id="a"></div><div id="b"></div>`;
    const { extension } = await makeExtension(display);

    extension.on_start({ targets: ["#a", "#b", "#missing"] });
    extension.on_load();
    const { saccade_targets } = extension.on_finish();

    expect(Object.keys(saccade_targets).sort()).toEqual(["#a", "#b"]);
    expect(Object.keys(saccade_targets["#a"]).sort()).toEqual([
      "bottom",
      "height",
      "left",
      "right",
      "top",
      "width",
      "x",
      "y",
    ]);
  });

  it("counts the frames dropped during the trial", async () => {
    const { extension, tracker } = await makeExtension(display);
    extension.on_start({ targets: [] });
    extension.on_load();
    tracker.emit(makeFrame({ time: { capture: 0, dropped: 2 } as any }));
    tracker.emit(makeFrame({ time: { capture: 33, dropped: 1 } as any }));

    expect(extension.on_finish().saccade_timing.dropped_frames).toBe(3);
  });

  it("unsubscribes from the tracker when the trial ends", async () => {
    const { extension, tracker } = await makeExtension(display);
    expect(tracker.subscriberCount).toBe(0);

    extension.on_start({ targets: [] });
    extension.on_load();
    expect(tracker.subscriberCount).toBe(1);

    extension.on_finish();
    expect(tracker.subscriberCount).toBe(0);

    // frames after the trial are not recorded
    tracker.emit(makeFrame());
    extension.on_start({ targets: [] });
    extension.on_load();
    expect(extension.on_finish().saccade_data).toHaveLength(0);
  });
});

describe("SaccadeExtension public API", () => {
  let display: HTMLElement;

  beforeEach(() => {
    display = document.createElement("div");
    document.body.appendChild(display);
    SaccadeTracker.instances.length = 0;
  });

  afterEach(() => {
    display.remove();
    jest.restoreAllMocks();
  });

  it("builds a tracker lazily and starts it once", async () => {
    const extension = new SaccadeExtension(makeJsPsych(display));
    await extension.initialize({ tta: 7, assets: { modelUrl: "/m.onnx" } });

    expect(extension.isInitialized()).toBe(false);
    await extension.start();
    await extension.start(); // idempotent

    expect(SaccadeTracker.instances).toHaveLength(1);
    expect(SaccadeTracker.instances[0].options).toMatchObject({
      tta: 7,
      assets: { modelUrl: "/m.onnx" },
    });
    expect(SaccadeTracker.instances[0].init).toHaveBeenCalledTimes(1);
    expect(extension.isInitialized()).toBe(true);
    expect(extension.getBackend()).toBe("webgpu");
    expect(extension.getTracker().running).toBe(true);
  });

  it("initializes the tracker eagerly when auto_initialize is set", async () => {
    const tracker = new SaccadeTracker();
    const extension = new SaccadeExtension(makeJsPsych(display));
    await extension.initialize({ tracker: tracker as any, auto_initialize: true });
    expect(extension.isInitialized()).toBe(true);
    expect(tracker.init).toHaveBeenCalled();
  });

  it("pauses and resumes the tracker", async () => {
    const { extension, tracker } = await makeExtension(display);
    await extension.start();
    expect(tracker.running).toBe(true);
    extension.pause();
    expect(tracker.running).toBe(false);
    extension.resume();
    expect(tracker.running).toBe(true);
  });

  it("converts calibration targets from pixels to viewport fractions", async () => {
    const { extension, tracker } = await makeExtension(display);
    const embeddings = [new Float32Array(128)];

    const n = await extension.calibratePoint(
      window.innerWidth / 2,
      window.innerHeight / 4,
      embeddings,
    );

    expect(n).toBe(1);
    expect(tracker.calibrationPoints).toHaveLength(1);
    expect(tracker.calibrationPoints[0].target.x).toBeCloseTo(0.5, 6);
    expect(tracker.calibrationPoints[0].target.y).toBeCloseTo(0.25, 6);
    expect(extension.getCalibrationPoints()).toHaveLength(1);

    extension.resetCalibration();
    expect(extension.getCalibrationPoints()).toHaveLength(0);
  });

  it("collects its own embeddings when none are supplied", async () => {
    const { extension, tracker } = await makeExtension(display);
    const n = await extension.calibratePoint(10, 10, undefined, 5);
    expect(n).toBeGreaterThan(0);
    expect(tracker.nextEmbedding).toHaveBeenCalled();
  });

  it("passes lambda through to the tracker's fit", async () => {
    const { extension } = await makeExtension(display);
    expect(extension.fitCalibration()).toBeNull();

    await extension.calibratePoint(0, 0, [new Float32Array(128)]);
    expect(extension.fitCalibration(2.5)).toEqual({ lambda: 2.5, nPoints: 1 });
    expect(extension.fitCalibration()).toEqual({ lambda: 1, nPoints: 1 });
  });

  it("notifies gaze subscribers and exposes the current prediction", async () => {
    const { extension, tracker } = await makeExtension(display);
    await extension.start();

    const seen: Array<{ x: number; y: number; t: number }> = [];
    const unsubscribe = extension.onGazeUpdate((s) => seen.push(s));

    tracker.emit(makeFrame({ gaze: { x: 0.5, y: 0.5 }, time: { capture: 500 } as any }));
    expect(seen).toHaveLength(1);
    expect(extension.getCurrentPrediction()).toEqual(seen[0]);
    expect(extension.faceDetected()).toBe(true);

    unsubscribe();
    tracker.emit(makeFrame());
    expect(seen).toHaveLength(1);
  });

  it("stores and clears the timing offset and the last loopback result", async () => {
    const { extension } = await makeExtension(display);
    expect(extension.getTimingOffset()).toBeNull();
    expect(extension.getLastLoopback()).toBeNull();

    extension.setTimingOffset(82);
    expect(extension.getTimingOffset()).toBe(82);
    extension.setTimingOffset(null);
    expect(extension.getTimingOffset()).toBeNull();

    const result = { lagMs: 82, verdict: "OK" } as any;
    extension.setLastLoopback(result);
    expect(extension.getLastLoopback()).toBe(result);
  });

  it("shows and hides the video preview and the gaze dot", async () => {
    const { extension, tracker } = await makeExtension(display);
    await extension.start();

    extension.showVideo();
    const container = document.getElementById("saccade-video-container");
    expect(container).not.toBeNull();
    expect(container.contains(tracker.video)).toBe(true);
    extension.hideVideo();
    expect(container.style.display).toBe("none");

    extension.showPredictions();
    const dot = document.getElementById("saccade-gaze-dot");
    expect(dot).not.toBeNull();
    tracker.emit(makeFrame({ gaze: { x: 0.5, y: 0.5 } }));
    expect(dot.classList.contains("saccade-visible")).toBe(true);

    extension.hidePredictions();
    expect(dot.classList.contains("saccade-visible")).toBe(false);
  });
});
