import { startTimeline } from "@jspsych/test-utils";
import { ParameterType, initJsPsych } from "jspsych";

import SaccadePerformancePlugin from ".";
import { quantile, summarise } from "./stats";
import { StubSaccadeExtension, StubTracker, makeFrame } from "./test-stubs/stub-extension";

function setup() {
  return initJsPsych({ extensions: [{ type: StubSaccadeExtension }] });
}

/**
 * No warm-up, and a measurement window long enough that every frame emitted synchronously
 * below lands inside it. The reported rates come from the synthetic `capture` timestamps on the
 * frames, not from how long the test really took, so they are deterministic.
 */
const FAST = { warmup_duration: 0, measurement_duration: 200 };

/** Let the trial's zero-length warm-up sleep resolve, so it is measuring when frames arrive. */
const startMeasuring = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("saccade-performance info", () => {
  it("is a well-formed plugin info block", () => {
    const info = SaccadePerformancePlugin.info;
    expect(info.name).toBe("saccade-performance");
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

  it("has the documented defaults, and includes everyone until told otherwise", () => {
    const p = SaccadePerformancePlugin.info.parameters;
    expect(p.measurement_duration.default).toBe(5000);
    expect(p.warmup_duration.default).toBe(1000);
    expect(typeof p.stimulus.default).toBe("string");
    expect(p.inclusion_function.default({} as any)).toBe(true);
    expect(typeof p.exclusion_message.default({} as any)).toBe("string");
  });

  it("documents the rate and diagnostic fields", () => {
    expect(Object.keys(SaccadePerformancePlugin.info.data).sort()).toEqual([
      "backend",
      "dropped",
      "embed_ms_median",
      "fps_mean",
      "fps_median",
      "fps_p10",
      "frames",
      "frames_without_face",
      "rt",
    ]);
  });
});

describe("saccade-performance measurement", () => {
  it("throws a helpful error when the extension is missing", () => {
    const plugin = new SaccadePerformancePlugin(initJsPsych());
    expect(() => plugin.trial(document.createElement("div"), {} as any, () => {})).toThrow(
      /requires the saccade extension/,
    );
  });

  it("reports the rate implied by the frames it saw", async () => {
    const jsPsych = setup();
    const { finished, getData } = await startTimeline(
      [{ type: SaccadePerformancePlugin, ...FAST }],
      jsPsych,
    );
    const tracker = (jsPsych.extensions.saccade as any).tracker as StubTracker;

    await startMeasuring();
    // 11 frames 20 ms apart: ten intervals, a steady 50 fps.
    tracker.emitSteady(11, 20, 1000);
    await finished;

    const data = getData().values()[0];
    expect(data.fps_median).toBeCloseTo(50);
    expect(data.fps_mean).toBeCloseTo(50);
    expect(data.fps_p10).toBeCloseTo(50);
    expect(data.frames).toBe(11);
    expect(data.frames_without_face).toBe(0);
    expect(data.embed_ms_median).toBe(8);
    expect(data.backend).toBe("webgpu");
  });

  it("keeps face-less frames out of the rate, because they never reach the model", async () => {
    const jsPsych = setup();
    const { finished, getData } = await startTimeline(
      [{ type: SaccadePerformancePlugin, ...FAST }],
      jsPsych,
    );
    const tracker = (jsPsych.extensions.saccade as any).tracker as StubTracker;

    await startMeasuring();
    // Two 100 ms intervals with a face, then a burst of face-less frames 1 ms apart. Counting
    // the burst would report ~1000 fps for a machine that is really running at 10.
    tracker.emit(makeFrame({ time: { capture: 0 } as any }));
    tracker.emit(makeFrame({ time: { capture: 100 } as any }));
    tracker.emit(makeFrame({ time: { capture: 200 } as any }));
    for (let i = 0; i < 5; i++) {
      tracker.emit(makeFrame({ faceFound: false, time: { capture: 201 + i } as any }));
    }
    await finished;

    const data = getData().values()[0];
    expect(data.fps_median).toBeCloseTo(10);
    expect(data.frames).toBe(3);
    expect(data.frames_without_face).toBe(5);
  });

  it("discards the warm-up frames", async () => {
    const jsPsych = setup();
    const { finished, getData } = await startTimeline(
      [{ type: SaccadePerformancePlugin, warmup_duration: 30, measurement_duration: 200 }],
      jsPsych,
    );
    const tracker = (jsPsych.extensions.saccade as any).tracker as StubTracker;

    // Still inside the warm-up: a slow first frame that must not count.
    tracker.emitSteady(4, 500, 0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    tracker.emitSteady(5, 25, 5000);
    await finished;

    const data = getData().values()[0];
    expect(data.frames).toBe(5);
    expect(data.fps_median).toBeCloseTo(40);
  });

  it("sums the camera frames the loop never saw", async () => {
    const jsPsych = setup();
    const { finished, getData } = await startTimeline(
      [{ type: SaccadePerformancePlugin, ...FAST }],
      jsPsych,
    );
    const tracker = (jsPsych.extensions.saccade as any).tracker as StubTracker;

    await startMeasuring();
    tracker.emit(makeFrame({ time: { capture: 0, dropped: 2 } as any }));
    tracker.emit(makeFrame({ time: { capture: 50, dropped: 3 } as any }));
    await finished;

    expect(getData().values()[0].dropped).toBe(5);
  });

  it("unsubscribes from the tracker when the trial ends", async () => {
    const jsPsych = setup();
    const { finished } = await startTimeline(
      [{ type: SaccadePerformancePlugin, ...FAST }],
      jsPsych,
    );
    const tracker = (jsPsych.extensions.saccade as any).tracker as StubTracker;

    await startMeasuring();
    expect(tracker.subscriberCount).toBe(1);
    await finished;
    expect(tracker.subscriberCount).toBe(0);
  });
});

describe("saccade-performance exclusion", () => {
  /** Run one trial, feed it 11 frames `intervalMs` apart, and return what it recorded. */
  const run = async (trialParams: Record<string, unknown>, intervalMs: number) => {
    const jsPsych = setup();
    const { finished, getData } = await startTimeline(
      [{ type: SaccadePerformancePlugin, ...FAST, ...trialParams }],
      jsPsych,
    );
    const tracker = (jsPsych.extensions.saccade as any).tracker as StubTracker;
    await startMeasuring();
    tracker.emitSteady(11, intervalMs, 1000);
    await finished;
    return getData().values()[0];
  };

  it("includes everyone when no inclusion_function is given", async () => {
    const data = await run({}, 200);
    expect(data.fps_median).toBeCloseTo(5);
    expect(data.rt).toBeGreaterThan(0);
  });

  it("hands the measured data to inclusion_function", async () => {
    const seen: any[] = [];
    await run(
      {
        inclusion_function: (data: any) => {
          seen.push(data);
          return true;
        },
      },
      20,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].fps_median).toBeCloseTo(50);
    expect(seen[0].backend).toBe("webgpu");
  });

  it("runs the rest of the timeline when the machine is fast enough", async () => {
    const jsPsych = setup();
    const { finished, getData } = await startTimeline(
      [
        {
          type: SaccadePerformancePlugin,
          ...FAST,
          inclusion_function: (data: any) => data.fps_median >= 15,
        },
        { type: SaccadePerformancePlugin, ...FAST },
      ],
      jsPsych,
    );
    const tracker = (jsPsych.extensions.saccade as any).tracker as StubTracker;
    await startMeasuring();
    tracker.emitSteady(11, 20, 1000);
    await startMeasuring();
    await finished;

    expect(getData().values()).toHaveLength(2);
  });

  it("ends the experiment when it is not, and still records the measurement", async () => {
    const jsPsych = setup();
    const { finished, getData } = await startTimeline(
      [
        {
          type: SaccadePerformancePlugin,
          ...FAST,
          inclusion_function: (data: any) => data.fps_median >= 15,
        },
        { type: SaccadePerformancePlugin, ...FAST },
      ],
      jsPsych,
    );
    const tracker = (jsPsych.extensions.saccade as any).tracker as StubTracker;
    await startMeasuring();
    // 5 fps: well under the threshold.
    tracker.emitSteady(11, 200, 1000);
    await finished;

    const values = getData().values();
    expect(values).toHaveLength(1);
    expect(values[0].fps_median).toBeCloseTo(5);
  });

  it("builds the exclusion message from the same data", async () => {
    const jsPsych = setup();
    const { finished, displayElement } = await startTimeline(
      [
        {
          type: SaccadePerformancePlugin,
          ...FAST,
          inclusion_function: (data: any) => data.fps_median >= 15,
          exclusion_message: (data: any) =>
            `<p>Too slow: ${data.fps_median.toFixed(0)} fps on ${data.backend}.</p>`,
        },
      ],
      jsPsych,
    );
    const tracker = (jsPsych.extensions.saccade as any).tracker as StubTracker;
    await startMeasuring();
    tracker.emitSteady(11, 200, 1000);
    await finished;

    expect(displayElement.innerHTML).toContain("Too slow: 5 fps on webgpu.");
  });

  it("excludes a machine it could not measure, without the inclusion_function doing extra work", async () => {
    const jsPsych = setup();
    const { finished, getData } = await startTimeline(
      [
        {
          type: SaccadePerformancePlugin,
          ...FAST,
          // The obvious comparison. `null >= 15` is false, so an unmeasurable machine is out.
          inclusion_function: (data: any) => data.fps_median >= 15,
        },
        { type: SaccadePerformancePlugin, ...FAST },
      ],
      jsPsych,
    );
    await finished;

    const values = getData().values();
    expect(values).toHaveLength(1);
    expect(values[0].fps_median).toBeNull();
    expect(values[0].frames).toBe(0);
  });

  it("ends the trial rather than freezing when the tracker will not start", async () => {
    const jsPsych = setup();
    const extension = jsPsych.extensions.saccade as any as StubSaccadeExtension;
    extension.startError = new Error("Permission denied");
    jest.spyOn(console, "error").mockImplementation(() => {});

    const { finished, getData } = await startTimeline(
      [{ type: SaccadePerformancePlugin, ...FAST }],
      jsPsych,
    );
    await finished;

    expect(getData().values()[0].fps_median).toBeNull();
    (console.error as jest.Mock).mockRestore();
  });
});

describe("statistics", () => {
  it("interpolates quantiles the way R type 7 and NumPy do", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5);
    expect(quantile([1, 2, 3, 4], 0.9)).toBeCloseTo(3.7);
  });

  it("separates the typical rate from the slow tail", () => {
    // A machine that runs at 100 fps but stalls for 200 ms every fifth frame. The median is
    // untouched by the stalls, so on its own it says the machine is fine; the p10 and the mean
    // are what show that a fifth of the samples arrive far too late.
    //
    // The p10 only moves when the slow frames are at least a tenth of them, which is the point
    // of it: one isolated hiccup should not fail a participant, a recurring one should.
    const intervals: number[] = [];
    for (let i = 0; i < 20; i++) intervals.push(i % 5 === 4 ? 200 : 10);
    let t = 0;
    const samples = [{ t: 0, faceFound: true, embedMs: 4, dropped: 0 }];
    for (const dt of intervals) {
      t += dt;
      samples.push({ t, faceFound: true, embedMs: 4, dropped: 0 });
    }

    const stats = summarise(samples);
    expect(stats.fps_median).toBeCloseTo(100);
    expect(stats.fps_p10).toBeCloseTo(5);
    expect(stats.fps_mean).toBeLessThan(stats.fps_median);
  });

  it("leaves the p10 alone for a single isolated hiccup", () => {
    const intervals = Array(20).fill(10);
    intervals[9] = 200;
    let t = 0;
    const samples = [{ t: 0, faceFound: true, embedMs: 4, dropped: 0 }];
    for (const dt of intervals) {
      t += dt;
      samples.push({ t, faceFound: true, embedMs: 4, dropped: 0 });
    }

    expect(summarise(samples).fps_p10).toBeCloseTo(100);
  });

  it("reports nulls rather than infinities when there is nothing to measure", () => {
    expect(summarise([])).toMatchObject({
      fps_median: null,
      fps_mean: null,
      fps_p10: null,
      frames: 0,
      dropped: 0,
      embed_ms_median: null,
    });
    // One frame is not an interval.
    expect(summarise([{ t: 5, faceFound: true, embedMs: 4, dropped: 1 }])).toMatchObject({
      fps_median: null,
      frames: 1,
      dropped: 1,
      embed_ms_median: 4,
    });
  });
});
