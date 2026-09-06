import { clickTarget, startTimeline } from "@jspsych/test-utils";
import { ParameterType, initJsPsych } from "jspsych";

import SaccadeTimeSyncPlugin from ".";
import { makeLoopbackResult, runLoopback } from "./test-stubs/saccadejs";
import { StubSaccadeExtension } from "./test-stubs/stub-extension";

function setup() {
  return initJsPsych({ extensions: [{ type: StubSaccadeExtension }] });
}

beforeEach(() => {
  (runLoopback as jest.Mock).mockClear();
});

describe("saccade-time-sync info", () => {
  it("is a well-formed plugin info block", () => {
    const info = SaccadeTimeSyncPlugin.info;
    expect(info.name).toBe("saccade-time-sync");
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
    const p = SaccadeTimeSyncPlugin.info.parameters;
    expect(p.duration.default).toBe(15000);
    expect(p.gap_min.default).toBe(500);
    expect(p.gap_max.default).toBe(1000);
    expect(p.contrast.default).toBe("full");
    expect(p.contrast.options).toEqual(["full", "reduced"]);
    expect(p.button_text.default).toBe("Start");
    expect(p.require_ok.default).toBe(false);
    expect(p.apply_offset.default).toBe(true);
    // the default instructions must say that there is no flicker
    expect(p.instructions.default).toMatch(/not a flashing or flickering display/i);
  });

  it("documents every loopback result field", () => {
    expect(Object.keys(SaccadeTimeSyncPlugin.info.data).sort()).toEqual([
      "applied",
      "camera_jitter_ms",
      "camera_period_ms",
      "clock_source",
      "dropped_frames",
      "halves_ms",
      "lag_ms",
      "peak_d",
      "plateau_width_ms",
      "raf_period_ms",
      "reason",
      "rt",
      "verdict",
    ]);
  });
});

describe("saccade-time-sync trial", () => {
  it("throws a helpful error when the extension is missing", () => {
    const plugin = new SaccadeTimeSyncPlugin(initJsPsych());
    expect(() => plugin.trial(document.createElement("div"), {} as any)).toThrow(
      /requires the saccade extension/,
    );
  });

  it("shows the instructions and start button first, and does not run until clicked", async () => {
    const jsPsych = setup();
    const { displayElement, expectRunning } = await startTimeline(
      [{ type: SaccadeTimeSyncPlugin, instructions: "<p>hello</p>", button_text: "Go" }],
      jsPsych,
    );

    expect(displayElement.innerHTML).toMatch(/hello/);
    const button = displayElement.querySelector<HTMLButtonElement>("#saccade-time-sync-start");
    expect(button.textContent).toBe("Go");
    expect(runLoopback).not.toHaveBeenCalled();
    await expectRunning();
  });

  it("runs the loopback and records every field", async () => {
    const jsPsych = setup();
    const { displayElement, getData, finished } = await startTimeline(
      [{ type: SaccadeTimeSyncPlugin, duration: 1000, gap_min: 100, gap_max: 200 }],
      jsPsych,
    );
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;

    await clickTarget(displayElement.querySelector("#saccade-time-sync-start"));
    await finished;

    expect(runLoopback).toHaveBeenCalledTimes(1);
    const [tracker, options] = (runLoopback as jest.Mock).mock.calls[0];
    expect(tracker).toBe(extension.tracker);
    expect(options).toMatchObject({
      durationMs: 1000,
      gapMinMs: 100,
      gapMaxMs: 200,
      levels: ["#000", "#fff"],
    });
    // the loopback draws on its own full-viewport overlay on document.body (the core default)
    expect(options.container).toBeUndefined();
    expect(typeof options.onProgress).toBe("function");

    const data = getData().values()[0];
    expect(data.lag_ms).toBe(82);
    expect(data.plateau_width_ms).toBe(20);
    expect(data.peak_d).toBeCloseTo(0.85);
    expect(data.halves_ms).toEqual([80, 84]);
    expect(data.camera_period_ms).toBeCloseTo(33.3);
    expect(data.camera_jitter_ms).toBeCloseTo(1.2);
    expect(data.dropped_frames).toBe(0);
    expect(data.raf_period_ms).toBeCloseTo(16.7);
    expect(data.clock_source).toBe("captureTime");
    expect(data.verdict).toBe("OK");
    expect(data.reason).toBeNull();
    expect(data.applied).toBe(true);
    expect(typeof data.rt).toBe("number");
  });

  it("applies the measured lag to the extension", async () => {
    const jsPsych = setup();
    const { displayElement, finished } = await startTimeline(
      [{ type: SaccadeTimeSyncPlugin }],
      jsPsych,
    );
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;

    await clickTarget(displayElement.querySelector("#saccade-time-sync-start"));
    await finished;

    expect(extension.setTimingOffset).toHaveBeenCalledWith(82);
    expect(extension.getTimingOffset()).toBe(82);
    expect(extension.setLastLoopback).toHaveBeenCalled();
    expect(extension.getLastLoopback().lagMs).toBe(82);
  });

  it("hides the jsPsych display while the screen flashes and restores it after", async () => {
    const jsPsych = setup();
    const seen: string[] = [];
    (runLoopback as jest.Mock).mockImplementationOnce(async () => {
      seen.push(jsPsych.getDisplayElement().style.visibility);
      return makeLoopbackResult();
    });

    const { displayElement, finished } = await startTimeline(
      [{ type: SaccadeTimeSyncPlugin }],
      jsPsych,
    );
    await clickTarget(displayElement.querySelector("#saccade-time-sync-start"));
    await finished;

    expect(seen).toEqual(["hidden"]);
    expect(displayElement.style.visibility).not.toBe("hidden");
    expect(document.getElementById("saccade-time-sync-progress")).toBeNull();
  });

  it("does not apply the offset when apply_offset is false", async () => {
    const jsPsych = setup();
    const { displayElement, getData, finished } = await startTimeline(
      [{ type: SaccadeTimeSyncPlugin, apply_offset: false }],
      jsPsych,
    );
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;

    await clickTarget(displayElement.querySelector("#saccade-time-sync-start"));
    await finished;

    expect(extension.setTimingOffset).not.toHaveBeenCalled();
    expect(getData().values()[0].applied).toBe(false);
    // the result is still recorded, so the experimenter can decide later
    expect(getData().values()[0].lag_ms).toBe(82);
  });

  it("uses the reduced-contrast levels when asked", async () => {
    const jsPsych = setup();
    const { displayElement, finished } = await startTimeline(
      [{ type: SaccadeTimeSyncPlugin, contrast: "reduced" }],
      jsPsych,
    );
    await clickTarget(displayElement.querySelector("#saccade-time-sync-start"));
    await finished;

    expect((runLoopback as jest.Mock).mock.calls[0][1].levels).toEqual(["#333", "#ccc"]);
  });

  it("re-runs an UNRELIABLE measurement once when require_ok is set", async () => {
    (runLoopback as jest.Mock)
      .mockResolvedValueOnce(
        makeLoopbackResult({ verdict: "UNRELIABLE", reason: "halves disagree" }),
      )
      .mockResolvedValueOnce(makeLoopbackResult({ verdict: "OK" }));

    const jsPsych = setup();
    const { displayElement, getData, finished } = await startTimeline(
      [{ type: SaccadeTimeSyncPlugin, require_ok: true }],
      jsPsych,
    );
    await clickTarget(displayElement.querySelector("#saccade-time-sync-start"));
    await finished;

    expect(runLoopback).toHaveBeenCalledTimes(2);
    expect(getData().values()[0].verdict).toBe("OK");
  });

  it("continues with a null result if the loopback throws", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (runLoopback as jest.Mock).mockRejectedValueOnce(new Error("no camera"));

    const jsPsych = setup();
    const { displayElement, getData, finished } = await startTimeline(
      [{ type: SaccadeTimeSyncPlugin }],
      jsPsych,
    );
    await clickTarget(displayElement.querySelector("#saccade-time-sync-start"));
    await finished;

    const data = getData().values()[0];
    expect(data.lag_ms).toBeNull();
    expect(data.verdict).toBeNull();
    expect(data.applied).toBe(false);
    errorSpy.mockRestore();
  });
});
