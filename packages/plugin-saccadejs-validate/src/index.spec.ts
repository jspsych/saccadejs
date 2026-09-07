import { clickTarget, startTimeline } from "@jspsych/test-utils";
import { ParameterType, initJsPsych } from "jspsych";

import SaccadeValidatePlugin from ".";
import { StubSaccadeExtension } from "./test-stubs/stub-extension";

function setup() {
  return initJsPsych({ extensions: [{ type: StubSaccadeExtension }] });
}

/** Fast parameters so a whole validation sequence runs inside a test. */
const FAST = { time_to_saccade: 1, validation_duration: 1 };

describe("saccade-validate info", () => {
  it("is a well-formed plugin info block", () => {
    const info = SaccadeValidatePlugin.info;
    expect(info.name).toBe("saccade-validate");
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
    const p = SaccadeValidatePlugin.info.parameters;
    expect(p.validation_points.default).toHaveLength(9);
    expect(p.validation_point_coordinates.default).toBe("percent");
    expect(p.roi_radius.default).toBe(200);
    expect(p.randomize_validation_order.default).toBe(false);
    expect(p.time_to_saccade.default).toBe(1000);
    expect(p.validation_duration.default).toBe(2000);
    expect(p.point_size.default).toBe(20);
    expect(p.show_validation_data.default).toBe(false);
  });

  it("documents the per-point data fields plus the error summaries", () => {
    expect(Object.keys(SaccadeValidatePlugin.info.data).sort()).toEqual([
      "average_offset",
      "median_error_px",
      "median_error_viewport",
      "percent_in_roi",
      "raw_gaze",
      "rt",
      "samples_per_sec",
      "validation_points",
    ]);
  });
});

describe("saccade-validate trial", () => {
  it("throws a helpful error when the extension is missing", () => {
    const plugin = new SaccadeValidatePlugin(initJsPsych());
    expect(() => plugin.trial(document.createElement("div"), {} as any)).toThrow(
      /requires the saccade extension/,
    );
  });

  it("records one nested array of samples per validation point", async () => {
    const jsPsych = setup();
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    // gaze lands exactly on the center of the viewport for every point
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    extension.gazeSamples = [
      { x: cx, y: cy, t: 0 },
      { x: cx, y: cy, t: 33 },
      { x: cx, y: cy, t: 66 },
    ];

    const { getData, finished } = await startTimeline(
      [{ type: SaccadeValidatePlugin, ...FAST, validation_points: [[50, 50]] }],
      jsPsych,
    );
    await finished;

    expect(extension.resume).toHaveBeenCalled();

    const data = getData().values()[0];
    expect(data.validation_points).toEqual([[50, 50]]);
    expect(data.raw_gaze).toHaveLength(1);
    expect(data.raw_gaze[0]).toHaveLength(3);
    expect(Object.keys(data.raw_gaze[0][0]).sort()).toEqual(["dx", "dy", "t", "x", "y"]);
    // dead-on gaze: zero offset, everything inside the ROI
    expect(data.raw_gaze[0][0].dx).toBeCloseTo(0, 6);
    expect(data.percent_in_roi).toEqual([100]);
    expect(data.average_offset[0].x).toBeCloseTo(0, 6);
    expect(data.average_offset[0].r).toBeCloseTo(0, 6);
    expect(data.median_error_px).toBeCloseTo(0, 6);
    expect(data.median_error_viewport).toBeCloseTo(0, 6);
    expect(typeof data.rt).toBe("number");
  });

  it("computes the offset from the target, in pixels and viewport units", async () => {
    const jsPsych = setup();
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    // one point at the very center; gaze sits 100 px to its right
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    extension.gazeSamples = [{ x: cx + 100, y: cy, t: 0 }];

    const { getData, finished } = await startTimeline(
      [
        {
          type: SaccadeValidatePlugin,
          ...FAST,
          validation_points: [[50, 50]],
          roi_radius: 50,
        },
      ],
      jsPsych,
    );
    await finished;

    const data = getData().values()[0];
    expect(data.raw_gaze[0][0].dx).toBeCloseTo(100, 6);
    expect(data.raw_gaze[0][0].dy).toBeCloseTo(0, 6);
    expect(data.percent_in_roi).toEqual([0]); // 100 px away, ROI is 50 px
    expect(data.median_error_px).toBeCloseTo(100, 6);
    expect(data.median_error_viewport).toBeCloseTo(100 / window.innerWidth, 6);
  });

  it("supports center-offset-pixels coordinates", async () => {
    const jsPsych = setup();
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    extension.gazeSamples = [{ x: cx + 200, y: cy - 100, t: 0 }];

    const { getData, finished } = await startTimeline(
      [
        {
          type: SaccadeValidatePlugin,
          ...FAST,
          validation_point_coordinates: "center-offset-pixels",
          validation_points: [[200, -100]],
        },
      ],
      jsPsych,
    );
    await finished;

    const data = getData().values()[0];
    expect(data.raw_gaze[0][0].dx).toBeCloseTo(0, 6);
    expect(data.raw_gaze[0][0].dy).toBeCloseTo(0, 6);
  });

  it("handles a point with no samples at all", async () => {
    const jsPsych = setup();
    const { getData, finished } = await startTimeline(
      [{ type: SaccadeValidatePlugin, ...FAST, validation_points: [[50, 50]] }],
      jsPsych,
    );
    await finished;

    const data = getData().values()[0];
    expect(data.raw_gaze[0]).toEqual([]);
    expect(data.percent_in_roi).toEqual([0]);
    expect(data.average_offset[0]).toEqual({ x: null, y: null, r: null });
    expect(data.median_error_px).toBeNull();
    expect(data.samples_per_sec).toBeNull();
  });

  it("shows the validation data and waits for a click when asked", async () => {
    const jsPsych = setup();
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    extension.gazeSamples = [{ x: 10, y: 10, t: 0 }];

    const { displayElement, expectRunning, finished } = await startTimeline(
      [
        {
          type: SaccadeValidatePlugin,
          ...FAST,
          validation_points: [[50, 50]],
          show_validation_data: true,
        },
      ],
      jsPsych,
    );

    // wait for the single point to finish
    await new Promise((resolve) => setTimeout(resolve, 30));
    await expectRunning();

    const button = displayElement.querySelector("#saccade-validate-continue");
    expect(button).not.toBeNull();
    await clickTarget(button);
    await finished;

    expect(document.querySelector(".saccade-target-overlay")).toBeNull();
  });

  it("cleans up the overlay when the trial ends", async () => {
    const jsPsych = setup();
    const { finished } = await startTimeline(
      [{ type: SaccadeValidatePlugin, ...FAST, validation_points: [[50, 50]] }],
      jsPsych,
    );
    await finished;
    expect(document.querySelector(".saccade-target-overlay")).toBeNull();
  });
});
