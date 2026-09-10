import { clickTarget, flushPromises, startTimeline } from "@jspsych/test-utils";
import { ParameterType, initJsPsych } from "jspsych";

import SaccadeCalibratePlugin from ".";
import { StubSaccadeExtension } from "./test-stubs/stub-extension";

function setup() {
  return initJsPsych({ extensions: [{ type: StubSaccadeExtension }] });
}

/** Fast parameters so a whole calibration sequence runs inside a test. */
const FAST = { time_to_saccade: 1, time_per_point: 1 };

describe("saccade-calibrate info", () => {
  it("is a well-formed plugin info block", () => {
    const info = SaccadeCalibratePlugin.info;
    expect(info.name).toBe("saccade-calibrate");
    expect(typeof info.version).toBe("string");
    expect(info.version.length).toBeGreaterThan(0);
    expect(info.citations).toBeDefined();

    for (const [name, param] of Object.entries(info.parameters)) {
      expect(Object.values(ParameterType)).toContain(param.type);
      expect(param).toHaveProperty("default");
      expect(name).toMatch(/^[a-z_]+$/);
    }
    for (const field of Object.values(info.data)) {
      expect(Object.values(ParameterType)).toContain(field.type);
    }
  });

  it("has the documented defaults", () => {
    const p = SaccadeCalibratePlugin.info.parameters;
    expect(p.calibration_points.default).toHaveLength(13);
    expect(p.calibration_points.default[0]).toEqual([5, 5]);
    expect(p.calibration_mode.default).toBe("view");
    expect(p.calibration_mode.options).toEqual(["view", "click"]);
    expect(p.repetitions_per_point.default).toBe(1);
    expect(p.randomize_calibration_order.default).toBe(false);
    expect(p.time_to_saccade.default).toBe(1000);
    expect(p.time_per_point.default).toBe(500);
    expect(p.point_size.default).toBe(20);
    expect(p.lambda.default).toBeNull();
    expect(p.clear_previous.default).toBe(true);
  });

  it("documents the calibration_points, n_points, lambda and weighting fields", () => {
    expect(Object.keys(SaccadeCalibratePlugin.info.data).sort()).toEqual([
      "calibration_points_px",
      "lambda",
      "n_points",
      "repetitions_per_point",
      "rt",
      "weighting",
    ]);
  });
});

describe("saccade-calibrate trial", () => {
  it("throws a helpful error when the extension is missing", () => {
    const plugin = new SaccadeCalibratePlugin(initJsPsych());
    expect(() => plugin.trial(document.createElement("div"), {} as any)).toThrow(
      /requires the saccade extension/,
    );
  });

  it("runs the whole point sequence in view mode and fits at the end", async () => {
    const jsPsych = setup();
    const { getData, finished } = await startTimeline(
      [{ type: SaccadeCalibratePlugin, ...FAST }],
      jsPsych,
    );
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;

    await finished;

    expect(extension.resetCalibration).toHaveBeenCalled();
    expect(extension.resume).toHaveBeenCalled();
    expect(extension.calibratePoint).toHaveBeenCalledTimes(13);
    expect(extension.fitCalibration).toHaveBeenCalledTimes(1);

    // targets are handed to the extension in viewport pixels
    const first = extension.calibrationCalls[0];
    expect(first.x).toBeCloseTo(0.05 * window.innerWidth, 6);
    expect(first.y).toBeCloseTo(0.05 * window.innerHeight, 6);
    expect(first.captureMs).toBe(1);

    const data = getData().values()[0];
    expect(data.calibration_points_px).toHaveLength(13);
    expect(data.calibration_points_px[0]).toEqual([
      Math.round(0.05 * window.innerWidth),
      Math.round(0.05 * window.innerHeight),
    ]);
    expect(data.n_points).toBe(13);
    expect(data.repetitions_per_point).toBe(1);
    expect(data.lambda).toBe(1);
    // The trial records how the fit weighted its rows: a weighted and an unweighted
    // calibration are different analyses, and nothing else in the data says which ran.
    expect(data.weighting).toBe("uniform");
    expect(typeof data.rt).toBe("number");
  });

  it("repeats the sequence and passes lambda through", async () => {
    const jsPsych = setup();
    const { getData, finished } = await startTimeline(
      [
        {
          type: SaccadeCalibratePlugin,
          ...FAST,
          calibration_points: [
            [25, 25],
            [75, 75],
          ],
          repetitions_per_point: 3,
          lambda: 3,
        },
      ],
      jsPsych,
    );
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;

    await finished;
    expect(extension.calibratePoint).toHaveBeenCalledTimes(6);
    expect(extension.fitCalibration).toHaveBeenCalledWith(3);

    const data = getData().values()[0];
    // two targets shown three times each: six presentations, two distinct targets
    expect(data.calibration_points_px).toHaveLength(6);
    expect(data.repetitions_per_point).toBe(3);
    expect(data.lambda).toBe(3);
    expect(data.n_points).toBe(2);
  });

  it("keeps earlier calibration points when clear_previous is false", async () => {
    const jsPsych = setup();
    const { finished } = await startTimeline(
      [
        {
          type: SaccadeCalibratePlugin,
          ...FAST,
          calibration_points: [[50, 50]],
          clear_previous: false,
        },
      ],
      jsPsych,
    );
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    await finished;
    expect(extension.resetCalibration).not.toHaveBeenCalled();
  });

  it("waits for a click on each point in click mode", async () => {
    const jsPsych = setup();
    const { displayElement, expectRunning, finished } = await startTimeline(
      [
        {
          type: SaccadeCalibratePlugin,
          ...FAST,
          calibration_mode: "click",
          calibration_points: [[50, 50]],
        },
      ],
      jsPsych,
    );
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;

    const target = displayElement.querySelector(".saccade-target");
    expect(target).not.toBeNull();
    expect(target.classList.contains("saccade-clickable")).toBe(true);
    expect(extension.calibratePoint).not.toHaveBeenCalled();
    await expectRunning();

    await clickTarget(target);
    await finished;
    expect(extension.calibratePoint).toHaveBeenCalledTimes(1);
  });

  it("shows the failure on screen instead of hanging when the frames stop", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const jsPsych = setup();
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    extension.calibratePoint.mockRejectedValue(new Error("no camera frames for 5000 ms"));

    const { getData, displayElement, finished } = await startTimeline(
      [{ type: SaccadeCalibratePlugin, ...FAST, calibration_points: [[50, 50]] }],
      jsPsych,
    );

    // The settle sleep is 1 ms; give it a tick, then let the rejection propagate.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushPromises();

    const message = displayElement.querySelector(".saccade-target-message");
    expect(message).not.toBeNull();
    expect(message.textContent).toMatch(/no camera frames for 5000 ms/);

    await clickTarget(displayElement.querySelector("#saccade-target-continue"));
    await finished;

    expect(getData().values()[0].lambda).toBeNull();
    expect(getData().values()[0].weighting).toBeNull();
    expect(document.querySelector(".saccade-target-overlay")).toBeNull();
    errorSpy.mockRestore();
  });

  it("cleans up the overlay when the trial ends", async () => {
    const jsPsych = setup();
    const { finished } = await startTimeline(
      [{ type: SaccadeCalibratePlugin, ...FAST, calibration_points: [[50, 50]] }],
      jsPsych,
    );
    await finished;
    expect(document.querySelector(".saccade-target-overlay")).toBeNull();
  });
});
