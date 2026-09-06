import { clickTarget, flushPromises, startTimeline } from "@jspsych/test-utils";
import { ParameterType, initJsPsych } from "jspsych";

import SaccadePreviewPlugin from ".";
import { StubSaccadeExtension, makeFrame } from "./test-stubs/stub-extension";

function setup() {
  const jsPsych = initJsPsych({ extensions: [{ type: StubSaccadeExtension }] });
  return jsPsych;
}

describe("saccade-preview info", () => {
  it("is a well-formed plugin info block", () => {
    const info = SaccadePreviewPlugin.info;
    expect(info.name).toBe("saccade-preview");
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
    const p = SaccadePreviewPlugin.info.parameters;
    expect(p.button_text.default).toBe("Continue");
    expect(p.show_eye_crop.default).toBe(true);
    expect(p.require_face.default).toBe(true);
    expect(p.preview_width.default).toBe(320);
    expect(p.face_timeout.default).toBeNull();
    expect(typeof p.instructions.default).toBe("string");
  });

  it("documents the load_time, face_detected, fps and backend fields", () => {
    expect(Object.keys(SaccadePreviewPlugin.info.data).sort()).toEqual([
      "backend",
      "face_detected",
      "fps",
      "load_time",
      "rt",
    ]);
  });
});

describe("saccade-preview trial", () => {
  it("throws a helpful error when the extension is missing", async () => {
    const jsPsych = initJsPsych();
    const plugin = new SaccadePreviewPlugin(jsPsych);
    expect(() => plugin.trial(document.createElement("div"), {} as any, () => {})).toThrow(
      /requires the saccade extension/,
    );
  });

  it("starts the tracker, waits for a face, and runs to completion", async () => {
    const jsPsych = setup();
    const { getData, displayElement, expectFinished } = await startTimeline(
      [{ type: SaccadePreviewPlugin }],
      jsPsych,
    );
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;

    await flushPromises();

    expect(extension.start).toHaveBeenCalled();
    expect(extension.resume).toHaveBeenCalled();

    const button = displayElement.querySelector<HTMLButtonElement>("#saccade-preview-continue");
    expect(button).not.toBeNull();
    // require_face defaults to true, so the button starts disabled
    expect(button.disabled).toBe(true);

    // the camera element and the eye-crop canvas are both in the preview panel
    expect(displayElement.querySelector("#saccade-preview-crop")).not.toBeNull();
    expect(displayElement.contains(extension.tracker.video)).toBe(true);

    extension.tracker.emit(makeFrame({ faceFound: true, fps: 29.5 }));
    expect(button.disabled).toBe(false);
    expect(displayElement.querySelector("#saccade-preview-face").textContent).toBe("yes");

    await clickTarget(button);
    await expectFinished();

    const data = getData().values()[0];
    expect(data.face_detected).toBe(true);
    expect(data.fps).toBeCloseTo(29.5);
    expect(data.backend).toBe("webgpu");
    expect(typeof data.load_time).toBe("number");
    expect(typeof data.rt).toBe("number");
    expect(extension.hideVideo).toHaveBeenCalled();
  });

  it("leaves the button enabled when require_face is false", async () => {
    const jsPsych = setup();
    const { displayElement, expectFinished } = await startTimeline(
      [{ type: SaccadePreviewPlugin, require_face: false, show_eye_crop: false }],
      jsPsych,
    );
    await flushPromises();

    const button = displayElement.querySelector<HTMLButtonElement>("#saccade-preview-continue");
    expect(button.disabled).toBe(false);
    expect(displayElement.querySelector<HTMLElement>("#saccade-preview-crop").style.display).toBe(
      "none",
    );

    await clickTarget(button);
    await expectFinished();
  });

  it("opens the continue button after face_timeout even with no face", async () => {
    const jsPsych = setup();
    const { displayElement, getData, finished } = await startTimeline(
      [{ type: SaccadePreviewPlugin, face_timeout: 20 }],
      jsPsych,
    );
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    await flushPromises();

    const button = displayElement.querySelector<HTMLButtonElement>("#saccade-preview-continue");
    expect(button.disabled).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(button.disabled).toBe(false);

    // a later face-less frame must not re-disable it
    extension.tracker.emit(makeFrame({ faceFound: false, gaze: null }));
    expect(button.disabled).toBe(false);

    await clickTarget(button);
    await finished;
    expect(getData().values()[0].face_detected).toBe(false);
  });

  it("shows an error message when the camera cannot be started", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const jsPsych = setup();
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    extension.start.mockRejectedValueOnce(new Error("NotAllowedError"));

    const { getHTML } = await startTimeline([{ type: SaccadePreviewPlugin }], jsPsych);
    await flushPromises();

    expect(getHTML()).toMatch(/eye tracker failed to start/);
    errorSpy.mockRestore();
  });
});
