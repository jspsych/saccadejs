import { flushPromises, startTimeline } from "@jspsych/test-utils";
import { ParameterType, initJsPsych } from "jspsych";

import SaccadeCatchUpPlugin from ".";
import { StubSaccadeExtension } from "./test-stubs/stub-extension";

function setup() {
  const jsPsych = initJsPsych({ extensions: [{ type: StubSaccadeExtension }] });
  return { jsPsych, extension: jsPsych.extensions.saccade as unknown as StubSaccadeExtension };
}

describe("saccade-catch-up info", () => {
  it("is a well-formed plugin info block", () => {
    const info = SaccadeCatchUpPlugin.info;
    expect(info.name).toBe("saccade-catch-up");
    expect(typeof info.version).toBe("string");
    for (const [name, param] of Object.entries(info.parameters)) {
      expect(Object.values(ParameterType)).toContain(param.type);
      expect(param).toHaveProperty("default");
      expect(name).toMatch(/^[a-z_]+$/);
    }
    expect(Object.keys(info.data).sort()).toEqual([
      "crops_saved",
      "frames_lost",
      "frames_waiting",
      "mode",
      "timed_out",
      "wait_ms",
    ]);
  });
});

describe("saccade-catch-up trial", () => {
  it("throws a helpful error when the extension is missing", () => {
    const plugin = new SaccadeCatchUpPlugin(initJsPsych());
    expect(() => plugin.trial(document.createElement("div"), {} as any, () => {})).toThrow(
      /requires the saccade extension/,
    );
  });

  it("ends at once in live mode, without pausing anything", async () => {
    const { jsPsych, extension } = setup();
    extension.mode = "live";
    const { getData, finished } = await startTimeline([{ type: SaccadeCatchUpPlugin }], jsPsych);
    await finished;
    expect(extension.pause).not.toHaveBeenCalled();
    expect(getData().values()[0]).toMatchObject({ mode: "live" });
  });

  it("waits for the workers, pausing the frame loop meanwhile, and records the result", async () => {
    const { jsPsych, extension } = setup();
    const { displayElement, getData, finished } = await startTimeline(
      [{ type: SaccadeCatchUpPlugin, max_wait: 30000, save_unprocessed_crops: true }],
      jsPsych,
    );
    expect(displayElement.innerHTML).toContain("Finishing up");
    expect(extension.pause).toHaveBeenCalled();
    expect(extension.catchUpOptions).toMatchObject({
      max_wait_ms: 30000,
      save_unprocessed_crops: true,
    });

    // Progress: half done, at 4 frames a second, 20 frames left is about 5 seconds.
    extension.catchUpOptions.onProgress(20, 40);
    expect(displayElement.querySelector<HTMLElement>("#saccade-catch-up-bar")!.style.width).toBe(
      "50%",
    );
    expect(displayElement.textContent).toContain("About 5 seconds left");

    extension.release();
    await flushPromises();
    await finished;
    expect(extension.resume).toHaveBeenCalled();
    expect(getData().values()[0]).toMatchObject({
      mode: "deferred",
      frames_waiting: 40,
      timed_out: false,
      wait_ms: 1234,
    });
  });

  it("waits without a time limit by default, and leaves the frame loop alone when told to", async () => {
    const { jsPsych, extension } = setup();
    const { finished } = await startTimeline(
      [{ type: SaccadeCatchUpPlugin, pause_tracking: false }],
      jsPsych,
    );
    expect(extension.catchUpOptions.max_wait_ms).toBeNull();
    expect(extension.catchUpOptions.save_unprocessed_crops).toBe(false);
    expect(extension.pause).not.toHaveBeenCalled();
    extension.release();
    await finished;
  });
});
