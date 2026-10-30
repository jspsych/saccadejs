import { JsPsych } from "jspsych";

import SaccadeExtension from ".";
import { SaccadeTracker, makeFrame } from "./test-stubs/saccadejs";

/**
 * A minimal jsPsych double: the extension calls `getDisplayElement()` and, once,
 * `data.addProperties()` to stamp which model produced the gaze.
 */
function makeJsPsych(display: HTMLElement, props: Record<string, unknown>[] = []) {
  return {
    getDisplayElement: () => display,
    data: { addProperties: (p: Record<string, unknown>) => props.push(p) },
  } as unknown as JsPsych;
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
      "saccade_deferred",
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
      smoothing_frames: 1,
      trial_start: expect.any(Number),
    });
  });

  it("reports the unrounded trial start that t is measured from", async () => {
    // A plugin logging its own performance.now() timestamps needs this exact zero to line them
    // up with saccade_data.
    const now = jest.spyOn(performance, "now").mockReturnValue(1234.5);
    const { extension, tracker } = await makeExtension(display);
    extension.setTimingOffset(20);
    extension.on_start({ targets: [] });
    extension.on_load();
    now.mockReturnValue(9999); // later clock readings must not move it

    const capture = 1354.5;
    tracker.emit(makeFrame({ time: { capture } as any }));
    const data = extension.on_finish();

    expect(data.saccade_timing.trial_start).toBe(1234.5);
    expect(data.saccade_data[0].t).toBe(
      Math.round(capture - data.saccade_timing.trial_start - data.saccade_timing.offset_ms!),
    );
  });

  it("feeds the prediction API from a supplied tracker without start()", async () => {
    // An experiment that brings its own tracker and skips `saccade-preview` never calls
    // `start()`. `saccade-validate` collects every sample through `onGazeUpdate`, so if the
    // frame subscription waited for `start()` it would record an empty validation.
    const { extension, tracker } = await makeExtension(display);
    const seen: number[] = [];
    extension.onGazeUpdate((sample) => seen.push(sample.x));

    tracker.emit(makeFrame({ gaze: { x: 0.5, y: 0.25 } }));

    expect(seen).toHaveLength(1);
    expect(extension.getCurrentPrediction()).not.toBeNull();
    expect(extension.faceDetected()).toBe(true);
  });

  it("reports the smoothing the tracker actually used, not the parameter", async () => {
    // A supplied tracker carries its own setting, and `setSmoothingFrames` can change it mid
    // experiment. `saccade_timing` has to describe the samples that were recorded.
    const { extension, tracker } = await makeExtension(display, { smoothing_frames: 5 });
    tracker.setSmoothingFrames(9);

    extension.on_start({ targets: [] });
    extension.on_load();
    expect(extension.on_finish().saccade_timing.smoothing_frames).toBe(9);
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

  it("times a sample by the smoothing window's mean capture, not the newest frame", async () => {
    jest.spyOn(performance, "now").mockReturnValue(1000);
    const { extension, tracker } = await makeExtension(display);
    extension.on_start({ targets: [] });
    extension.on_load();

    // newest frame captured at 1200, but the smoothed gaze refers to 1100
    tracker.emit(makeFrame({ time: { capture: 1200, meanCapture: 1100 } as any }));
    expect(extension.on_finish().saccade_data[0].t).toBe(100);
  });

  it("falls back to the frame's own capture time when there is no smoothing mean", async () => {
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

  it("gives the live gaze API the same absolute t inside a recording trial and outside one", async () => {
    // A subscription outlives trials, and `saccade-validate` subtracts a start time it stamped
    // itself. The live `t` used to switch to trial-relative while a trial was recording.
    const now = jest.spyOn(performance, "now").mockReturnValue(1000);
    const { extension, tracker } = await makeExtension(display);
    const seen: number[] = [];
    extension.onGazeUpdate((s) => seen.push(s.t));

    tracker.emit(makeFrame({ time: { capture: 1250 } as any }));
    expect(extension.getCurrentPrediction().t).toBe(1250);

    now.mockReturnValue(1200);
    extension.on_start({ targets: [] });
    extension.on_load(); // trial starts at 1200
    tracker.emit(makeFrame({ time: { capture: 1250 } as any }));
    expect(extension.getCurrentPrediction().t).toBe(1250);
    const { saccade_data } = extension.on_finish();

    tracker.emit(makeFrame({ time: { capture: 1250 } as any }));
    expect(seen).toEqual([1250, 1250, 1250]);
    expect(extension.getCurrentPrediction().t).toBe(1250);
    // ...while the recorded row is still measured from the trial start.
    expect(saccade_data.map((s) => s.t)).toEqual([50]);
  });

  it("subtracts the timing offset from the live gaze t in and out of a trial", async () => {
    jest.spyOn(performance, "now").mockReturnValue(1000);
    const { extension, tracker } = await makeExtension(display);
    extension.setTimingOffset(25);
    const seen: number[] = [];
    extension.onGazeUpdate((s) => seen.push(s.t));

    tracker.emit(makeFrame({ time: { capture: 1100, meanCapture: 1090 } as any }));
    expect(extension.getCurrentPrediction().t).toBe(1065);

    extension.on_start({ targets: [] });
    extension.on_load(); // trial starts at 1000
    tracker.emit(makeFrame({ time: { capture: 1100, meanCapture: 1090 } as any }));
    expect(extension.getCurrentPrediction().t).toBe(1065);
    const { saccade_data } = extension.on_finish();

    expect(seen).toEqual([1065, 1065]);
    expect(saccade_data[0].t).toBe(65);
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

  it("does not lock in a target that has no layout box yet", async () => {
    // An <img> in the DOM whose bitmap has not arrived reports 0 x 0. Recording that would put a
    // zero-size box in the data and make the trial's gaze impossible to hit-test.
    display.innerHTML = `<img id="late" />`;
    const img = display.querySelector("#late") as HTMLElement;
    const rect = jest.spyOn(img, "getBoundingClientRect");
    rect.mockReturnValue({
      x: 40,
      y: 20,
      width: 0,
      height: 0,
      top: 20,
      bottom: 20,
      left: 40,
      right: 40,
    } as DOMRect);

    const { extension, tracker } = await makeExtension(display);
    extension.on_start({ targets: ["#late"] });
    extension.on_load();
    expect(extension["targetsPending"]).toBe(true);

    // The image lays out. That is not a DOM mutation, so only the next camera frame notices.
    rect.mockReturnValue({
      x: 40,
      y: 20,
      width: 300,
      height: 200,
      top: 20,
      bottom: 220,
      left: 40,
      right: 340,
    } as DOMRect);
    tracker.emit(makeFrame());

    const { saccade_targets } = extension.on_finish();
    expect(saccade_targets["#late"]).toMatchObject({ width: 300, height: 200, left: 40, top: 20 });
  });

  it("keeps the first real rect once a target has been measured", async () => {
    display.innerHTML = `<div id="stable"></div>`;
    const el = display.querySelector("#stable") as HTMLElement;
    const rect = jest.spyOn(el, "getBoundingClientRect");
    rect.mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      top: 0,
      bottom: 50,
      left: 0,
      right: 100,
    } as DOMRect);

    const { extension, tracker } = await makeExtension(display);
    extension.on_start({ targets: ["#stable"] });
    extension.on_load();
    expect(extension["targetsPending"]).toBe(false);

    // Whatever the element does later, the trial recorded where it was when it was presented.
    rect.mockReturnValue({
      x: 999,
      y: 999,
      width: 1,
      height: 1,
      top: 999,
      bottom: 1000,
      left: 999,
      right: 1000,
    } as DOMRect);
    tracker.emit(makeFrame());

    expect(extension.on_finish().saccade_targets["#stable"]).toMatchObject({
      width: 100,
      height: 50,
    });
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
    // One subscriber throughout: the persistent handler behind `getCurrentPrediction` and the
    // gaze dot. The trial-scoped one that fills `saccade_data` is the second, and only that one
    // comes and goes with the trial.
    expect(tracker.subscriberCount).toBe(1);

    extension.on_start({ targets: [] });
    extension.on_load();
    expect(tracker.subscriberCount).toBe(2);

    extension.on_finish();
    expect(tracker.subscriberCount).toBe(1);

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
    await extension.initialize({ smoothing_frames: 7, assets: { modelUrl: "/m.onnx" } });

    expect(extension.isInitialized()).toBe(false);
    await extension.start();
    await extension.start(); // idempotent

    expect(SaccadeTracker.instances).toHaveLength(1);
    expect(SaccadeTracker.instances[0].options).toMatchObject({
      smoothingFrames: 7,
      assets: { modelUrl: "/m.onnx" },
    });
    expect(SaccadeTracker.instances[0].init).toHaveBeenCalledTimes(1);
    expect(extension.isInitialized()).toBe(true);
    expect(extension.getBackend()).toBe("webgpu");
    expect(extension.getTracker().running).toBe(true);
  });

  it("puts the camera element in the document as soon as a tracker exists", async () => {
    // Without the preview plugin nothing ever calls showVideo(), and an unrendered <video>
    // gets no camera frames in Chrome — so the extension parks it itself.
    const extension = new SaccadeExtension(makeJsPsych(display));
    await extension.initialize({});
    const tracker = extension.getTracker() as unknown as SaccadeTracker;
    expect(tracker.video.isConnected).toBe(true);
    const container = document.getElementById("saccade-video-container");
    expect(container.contains(tracker.video)).toBe(true);
    expect(container.classList.contains("saccade-hidden")).toBe(true);
    expect(container.style.display).toBe("");
  });

  it("does not touch the camera until something starts it", async () => {
    // initialize() runs during initJsPsych, before any trial is on screen: prompting for the
    // camera there is exactly what the saccade-preview trial exists to avoid.
    const tracker = new SaccadeTracker();
    const extension = new SaccadeExtension(makeJsPsych(display));
    await extension.initialize({ tracker: tracker as any });
    expect(extension.isInitialized()).toBe(false);
    expect(tracker.init).not.toHaveBeenCalled();

    await extension.start();
    expect(extension.isInitialized()).toBe(true);
    expect(tracker.init).toHaveBeenCalled();
  });

  it("warns once when a trial records before the camera has been started", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const extension = new SaccadeExtension(makeJsPsych(display));

    extension.on_start({ targets: [] });
    extension.on_load();
    expect(warn).toHaveBeenCalledTimes(1);

    extension.on_start({ targets: [] });
    extension.on_load();
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
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
    expect(tracker.nextSample).toHaveBeenCalled();
  });

  it("passes lambda and fit through to the tracker's fit", async () => {
    const { extension } = await makeExtension(display);
    expect(extension.fitCalibration()).toBeNull();

    await extension.calibratePoint(0, 0, [new Float32Array(128)]);
    expect(extension.fitCalibration(2.5)).toEqual({
      lambda: 2.5,
      nPoints: 1,
      weighting: "uniform",
      fit: "frames",
    });
    expect(extension.fitCalibration()).toEqual({
      lambda: 1,
      nPoints: 1,
      weighting: "uniform",
      fit: "frames",
    });
    expect(extension.fitCalibration(undefined, "points")).toEqual({
      lambda: 1,
      nPoints: 1,
      weighting: "uniform",
      fit: "points",
    });
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
    expect(container.classList.contains("saccade-hidden")).toBe(false);

    extension.hideVideo();
    // Hidden, but still rendered and still holding the video: display:none or a detached
    // element would stop Chrome delivering camera frames.
    expect(container.classList.contains("saccade-hidden")).toBe(true);
    expect(container.style.display).toBe("");
    expect(container.contains(tracker.video)).toBe(true);
    expect(container.isConnected).toBe(true);

    // A plugin that borrowed the video (the preview plugin puts it in the jsPsych display)
    // hands it back on hideVideo, so clearing that display cannot destroy it.
    display.appendChild(tracker.video);
    extension.hideVideo();
    expect(container.contains(tracker.video)).toBe(true);
    display.innerHTML = "";
    expect(tracker.video.isConnected).toBe(true);

    extension.showPredictions();
    const dot = document.getElementById("saccade-gaze-dot");
    expect(dot).not.toBeNull();
    tracker.emit(makeFrame({ gaze: { x: 0.5, y: 0.5 } }));
    expect(dot.classList.contains("saccade-visible")).toBe(true);

    extension.hidePredictions();
    expect(dot.classList.contains("saccade-visible")).toBe(false);
  });

  it("gives up on a dead frame source instead of collecting forever", async () => {
    const { extension, tracker } = await makeExtension(display);
    tracker.nextSample.mockImplementation(() => new Promise(() => undefined) as any);

    await expect(extension.calibratePoint(0, 0, undefined, 1000, 20)).rejects.toThrow(
      /no camera frames for 20 ms/,
    );
  });

  it("fans the tracker's setup progress out to subscribers", async () => {
    const extension = new SaccadeExtension(makeJsPsych(display));
    await extension.initialize({});
    extension.getTracker();
    const tracker = SaccadeTracker.instances[0];

    const seen: any[] = [];
    const unsubscribe = extension.onSetupProgress((p) => seen.push(p));
    tracker.emitProgress({ stage: "model", loaded: 5, total: 20 });

    expect(seen).toEqual([{ stage: "model", loaded: 5, total: 20 }]);
    expect(extension.getSetupProgress()).toEqual({ stage: "model", loaded: 5, total: 20 });

    // A late subscriber is handed the most recent report straight away.
    const late: any[] = [];
    extension.onSetupProgress((p) => late.push(p));
    expect(late).toHaveLength(1);

    unsubscribe();
    tracker.emitProgress({ stage: "ready" });
    expect(seen).toHaveLength(1);

    extension.dispose();
  });

  it("reports setup progress for a tracker handed in, and lets go of it on dispose", async () => {
    const tracker = new SaccadeTracker();
    const extension = new SaccadeExtension(makeJsPsych(display));
    await extension.initialize({ tracker: tracker as any });

    const seen: any[] = [];
    extension.onSetupProgress((p) => seen.push(p));
    tracker.emitProgress({ stage: "model", loaded: 5, total: 20 });
    expect(seen).toEqual([{ stage: "model", loaded: 5, total: 20 }]);

    extension.dispose();
    tracker.emitProgress({ stage: "ready" });
    expect(extension.getSetupProgress()).toBeNull();
  });

  it("disposes the tracker it built, and clears its overlays", async () => {
    const extension = new SaccadeExtension(makeJsPsych(display));
    await extension.initialize({});
    const tracker = extension.getTracker() as unknown as SaccadeTracker;
    const disposeSpy = jest.spyOn(tracker, "dispose");
    await extension.start();
    extension.showVideo();
    extension.showPredictions();

    extension.dispose();

    expect(disposeSpy).toHaveBeenCalled();
    expect(document.getElementById("saccade-video-container")).toBeNull();
    expect(document.getElementById("saccade-gaze-dot")).toBeNull();
    expect(extension.isInitialized()).toBe(false);
    expect(extension.getBackend()).toBeNull();
    expect(extension.getSetupProgress()).toBeNull();

    // A later start() builds a fresh tracker rather than reusing the disposed one.
    expect(extension.getTracker()).not.toBe(tracker);
  });

  it("leaves a tracker it was handed alone", async () => {
    const { extension, tracker } = await makeExtension(display);
    const disposeSpy = jest.spyOn(tracker, "dispose");
    await extension.start();

    extension.dispose();

    expect(disposeSpy).not.toHaveBeenCalled();
    expect(tracker.running).toBe(false);
  });
});

describe("recording which model produced the gaze", () => {
  it("stamps saccade_model once, when the tracker it built initialises", async () => {
    const display = document.createElement("div");
    const props: Record<string, unknown>[] = [];
    const extension = new SaccadeExtension(makeJsPsych(display, props));
    await extension.initialize();

    expect(props).toHaveLength(0); // initialize() must not touch the camera or the data

    await extension.start();
    expect(props).toEqual([{ saccade_model: "eye-embedding@1.0.0" }, { saccade_mode: "live" }]);

    // Idempotent: restarting must not add a second copy to every trial.
    await extension.start();
    await extension.start();
    expect(props).toHaveLength(2);
  });

  it("stamps a tracker it was handed, which an experiment may never start() itself", async () => {
    const display = document.createElement("div");
    const props: Record<string, unknown>[] = [];
    const tracker = new SaccadeTracker();
    await tracker.init();
    const extension = new SaccadeExtension(makeJsPsych(display, props));
    await extension.initialize({ tracker: tracker as any });

    expect(props).toEqual([{ saccade_model: "eye-embedding@1.0.0" }]);
  });

  it("records a fingerprint, not a guess, for a model that is not a published release", async () => {
    const display = document.createElement("div");
    const props: Record<string, unknown>[] = [];
    const extension = new SaccadeExtension(makeJsPsych(display, props));
    await extension.initialize();
    await extension.start();
    // The tracker the extension built is the most recent stub instance.
    const built = SaccadeTracker.instances.at(-1)!;
    expect(built).toBeDefined();
    props.length = 0;

    // A second extension, handed a tracker running someone else's weights.
    const custom = new SaccadeTracker();
    custom.modelIdentity = {
      sha256: "f4669a8398d940f89a907e57df68332ad71647749e6b6d1e7c80ea174191d281",
      version: null,
      contract: null,
      url: "https://example.org/my-model.onnx",
      resolvedFrom: "hash-only",
      // Not a published release, and a different width — which the tracker reports honestly
      // rather than assuming the shipped model's shape.
      dim: 64,
      emitsWeight: false,
    };
    await custom.init();
    const ext2 = new SaccadeExtension(makeJsPsych(display, props));
    await ext2.initialize({ tracker: custom as any });

    expect(props).toEqual([{ saccade_model: "sha256:f4669a8398d9" }]);
  });

  it("never lets a data-write failure end the run", async () => {
    const display = document.createElement("div");
    const broken = { getDisplayElement: () => display } as unknown as JsPsych; // no .data
    const extension = new SaccadeExtension(broken);
    await extension.initialize();
    await expect(extension.start()).resolves.toBeUndefined();
  });
});

describe("deferred mode", () => {
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

  /** A started extension whose tracker is in deferred mode and calibrated. */
  async function deferredExtension(params: Record<string, any> = {}) {
    const props: Record<string, unknown>[] = [];
    const extension = new SaccadeExtension(makeJsPsych(display, props));
    await extension.initialize({ mode: "deferred", ...params });
    await extension.start();
    const tracker = SaccadeTracker.instances[0];
    tracker.addCalibrationPoint({ x: 0.5, y: 0.5 }, [new Float32Array(2)]);
    return { extension, tracker, props };
  }

  function frame(capture: number) {
    return makeFrame({
      gaze: null,
      embedding: null,
      crop: new Uint8Array(144 * 36),
      time: { capture } as any,
    });
  }

  it("stays live, without measuring anything, unless asked", async () => {
    const extension = new SaccadeExtension(makeJsPsych(display));
    await extension.initialize();
    await extension.start();
    const tracker = SaccadeTracker.instances[0];
    expect(tracker.measureEmbedMs).not.toHaveBeenCalled();
    expect(tracker.enableDeferred).not.toHaveBeenCalled();
    expect(extension.getMode()).toBe("live");
  });

  it("switches to deferred when asked, and records the mode on every trial", async () => {
    const { extension, tracker, props } = await deferredExtension({ deferred_workers: 2 });
    expect(tracker.enableDeferred).toHaveBeenCalledWith({ workers: 2 });
    expect(extension.getMode()).toBe("deferred");
    expect(props).toContainEqual({ saccade_mode: "deferred" });
  });

  it("decides by timing the model in auto mode", async () => {
    const extension = new SaccadeExtension(makeJsPsych(display));
    await extension.initialize({ mode: "auto" });
    const tracker = new SaccadeTracker();
    // Too slow for a 30 fps camera: 85% of 33 ms is under the 30 ms floor, so the limit is 30.
    tracker.embedTiming = { ep: "webgpu", embedMs: 45, samples: 5 };
    SaccadeTracker.instances.length = 0;
    (extension as any).tracker = tracker;
    await extension.start();
    expect(extension.getMode()).toBe("deferred");
    expect(extension.getModeDecision()).toMatchObject({ reason: "too slow", embedMs: 45 });

    const fast = new SaccadeExtension(makeJsPsych(display));
    await fast.initialize({ mode: "auto" });
    await fast.start();
    expect(fast.getMode()).toBe("live");
    expect(fast.getModeDecision()).toMatchObject({ mode: "live", reason: "fast enough" });
  });

  it("falls back to live when the workers will not start", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const extension = new SaccadeExtension(makeJsPsych(display));
    await extension.initialize({ mode: "deferred" });
    const tracker = new SaccadeTracker();
    tracker.deferredFails = true;
    (extension as any).tracker = tracker;
    await extension.start();
    expect(extension.getMode()).toBe("live");
    expect(extension.getModeDecision()).toMatchObject({ mode: "live", error: "no worker started" });
  });

  it("returns saccade_data empty and fills it in once the frames are embedded", async () => {
    const { extension, tracker } = await deferredExtension();
    extension.on_start({ targets: [] });
    extension.on_load();
    const start = (extension as any).currentTrialStart;
    tracker.emit(frame(start + 100));
    tracker.emit(frame(start + 133));
    tracker.emit(makeFrame({ faceFound: false, gaze: null, crop: null }));
    const result = extension.on_finish();

    expect(result.saccade_data).toEqual([]);
    expect(result.saccade_deferred).toEqual({ frames: 2, embedded: 0, lost: 0, complete: false });

    tracker.deferred!.answer(0.25, 0.5);
    await extension.catchUp();
    expect(result.saccade_deferred).toEqual({ frames: 2, embedded: 2, lost: 0, complete: true });
    expect(result.saccade_data).toEqual([
      { x: Math.round(0.25 * window.innerWidth), y: Math.round(0.5 * window.innerHeight), t: 100 },
      { x: Math.round(0.25 * window.innerWidth), y: Math.round(0.5 * window.innerHeight), t: 133 },
    ]);
  });

  it("queues nothing before there is a calibration to map the frames with", async () => {
    const { extension, tracker } = await deferredExtension();
    tracker.clearCalibration();
    extension.on_start({ targets: [] });
    extension.on_load();
    tracker.emit(frame(performance.now()));
    const result = extension.on_finish();
    expect(result.saccade_deferred).toEqual({ frames: 0, embedded: 0, lost: 0, complete: true });
    expect(tracker.deferred!.pending).toBe(0);
  });

  it("gives up at max_wait, and saves the lost crops only when asked", async () => {
    const { extension, tracker } = await deferredExtension();
    const record = () => {
      extension.on_start({ targets: [] });
      extension.on_load();
      const start = (extension as any).currentTrialStart;
      tracker.emit(frame(start + 10));
      return extension.on_finish();
    };

    const dropped = record();
    const first = await extension.catchUp({ max_wait_ms: 0 });
    expect(first).toMatchObject({
      mode: "deferred",
      frames_waiting: 1,
      frames_lost: 1,
      timed_out: true,
      crops_saved: 0,
    });
    expect(dropped.saccade_deferred).toMatchObject({ lost: 1, complete: true });
    expect(dropped.saccade_deferred!.crops).toBeUndefined();

    const saved = record();
    const second = await extension.catchUp({ max_wait_ms: 0, save_unprocessed_crops: true });
    expect(second.crops_saved).toBe(1);
    const crops = saved.saccade_deferred!.crops!;
    expect(crops).toMatchObject({ t: [10], width: 144, height: 36, kernel: [1, 0, 0, 1] });
    expect(atob(crops.data)).toHaveLength(144 * 36);
  });

  it("resolves catchUp at once in live mode", async () => {
    const extension = new SaccadeExtension(makeJsPsych(display));
    await extension.initialize();
    await extension.start();
    await expect(extension.catchUp()).resolves.toMatchObject({
      mode: "live",
      frames_waiting: 0,
      timed_out: false,
    });
  });

  it("adds calibration points only once their frames are embedded", async () => {
    const { extension, tracker } = await deferredExtension();
    tracker.clearCalibration();
    tracker.nextFrame = async () => frame(0) as any;
    const queued = await extension.calibratePoint(100, 100, undefined, 20);
    expect(queued).toBeGreaterThan(0);
    expect(tracker.calibrationPoints).toHaveLength(0);

    const finishing = extension.finishCalibration();
    tracker.deferred!.answer(0.1, 0.1);
    await finishing;
    expect(tracker.calibrationPoints).toHaveLength(1);
    expect(tracker.calibrationPoints[0].embeddings).toHaveLength(queued);
  });

  it("collects gaze for validation from the embedded frames", async () => {
    const { extension, tracker } = await deferredExtension();
    const stop = extension.collectGaze();
    tracker.emit(frame(500));
    const collecting = stop();
    tracker.deferred!.answer(0.5, 0.25);
    const rows = await collecting;
    expect(rows).toEqual([
      { x: Math.round(0.5 * window.innerWidth), y: Math.round(0.25 * window.innerHeight), t: 500 },
    ]);
  });

  it("collects live gaze the same way in live mode", async () => {
    const { extension, tracker } = await makeExtension(display);
    const stop = extension.collectGaze();
    tracker.emit(makeFrame({ gaze: { x: 0.5, y: 0.5 }, time: { capture: 42 } as any }));
    const rows = await stop();
    expect(rows).toHaveLength(1);
    expect(rows[0].t).toBe(42);
  });
});
