import { clickTarget, flushPromises, startTimeline } from "@jspsych/test-utils";
import { ParameterType, initJsPsych } from "jspsych";

import SaccadePreviewPlugin from ".";
import { SetupFeedback } from "./setup-feedback";
import { setupFraction, setupLabel } from "./setup-progress";
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
    expect(p.show_progress.default).toBe(true);
    expect(p.show_diagnostics.default).toBe(false);
    expect(p.show_setup_feedback.default).toBe(true);
    expect(p.min_interocular_distance.default).toBe(0.14);
    expect(p.max_interocular_distance.default).toBe(0.32);
    expect(p.min_eye_contrast.default).toBe(17);
    expect(typeof p.instructions.default).toBe("string");
  });

  it("documents its data fields", () => {
    expect(Object.keys(SaccadePreviewPlugin.info.data).sort()).toEqual([
      "backend",
      "distance_feedback",
      "eye_brightness",
      "eye_contrast",
      "face_detected",
      "fps",
      "interocular_distance",
      "lighting_feedback",
      "load_time",
      "rt",
    ]);
  });
});

const quality = (interocularDistance: number, eyeContrast: number, eyeBrightness = 100) => ({
  interocularDistance,
  eyeContrast,
  eyeBrightness,
});

const thresholds = {
  minInterocularDistance: 0.14,
  maxInterocularDistance: 0.32,
  minEyeContrast: 17,
};

describe("setup feedback", () => {
  it("has no reading until a frame with measures arrives", () => {
    const f = new SetupFeedback(thresholds);
    f.update(null);
    expect(f.distance).toBeNull();
    expect(f.lighting).toBeNull();
    expect(f.interocularDistance).toBeNull();
  });

  it("asks a participant who is far away to move closer, and one too near to move back", () => {
    const f = new SetupFeedback(thresholds);
    f.update(quality(0.1, 30));
    expect(f.distance).toBe("closer");
    const g = new SetupFeedback(thresholds);
    g.update(quality(0.4, 30));
    expect(g.distance).toBe("farther");
    const h = new SetupFeedback(thresholds);
    h.update(quality(0.2, 30));
    expect(h.distance).toBe("good");
    expect(h.lighting).toBe("good");
  });

  it("says why the eyes lack contrast, from their brightness", () => {
    const dark = new SetupFeedback(thresholds);
    dark.update(quality(0.2, 10, 30));
    expect(dark.lighting).toBe("dark");
    const bright = new SetupFeedback(thresholds);
    bright.update(quality(0.2, 10, 200));
    expect(bright.lighting).toBe("bright");
    const flat = new SetupFeedback(thresholds);
    flat.update(quality(0.2, 10, 100));
    expect(flat.lighting).toBe("flat");
  });

  it("averages over recent frames, so one odd frame does not change the advice", () => {
    const f = new SetupFeedback(thresholds);
    for (let i = 0; i < 30; i++) f.update(quality(0.2, 30));
    f.update(quality(0.05, 2));
    expect(f.distance).toBe("good");
    expect(f.lighting).toBe("good");
    expect(f.interocularDistance).toBeCloseTo((9 * 0.2 + 0.05) / 10, 10);
  });

  it("needs a reading a little past the threshold to clear a warning", () => {
    const f = new SetupFeedback(thresholds);
    for (let i = 0; i < 30; i++) f.update(quality(0.13, 30));
    expect(f.distance).toBe("closer");
    // at the threshold itself the warning stays
    for (let i = 0; i < 30; i++) f.update(quality(0.141, 30));
    expect(f.distance).toBe("closer");
    for (let i = 0; i < 30; i++) f.update(quality(0.16, 30));
    expect(f.distance).toBe("good");
  });
});

describe("setup progress formatting", () => {
  it("names the stage, and the bytes for the model download", () => {
    expect(setupLabel(null)).toBe("Starting…");
    expect(setupLabel({ stage: "camera" })).toBe("Waiting for permission to use your camera…");
    expect(setupLabel({ stage: "ort" })).toBe("Loading…");
    expect(setupLabel({ stage: "session" })).toBe("Almost ready…");
    expect(setupLabel({ stage: "model", loaded: 12.3e6, total: 20.6e6 })).toBe(
      "Downloading the eye tracker (12.3 of 20.6 MB)…",
    );
    // No Content-Length: report what has arrived rather than a fraction of nothing.
    expect(setupLabel({ stage: "model", loaded: 5e6 })).toBe(
      "Downloading the eye tracker (5.0 MB)…",
    );
    expect(setupLabel({ stage: "ready" })).toBe("Ready");
  });

  it("grows monotonically through the stages and ends at 1", () => {
    const stages = ["camera", "mediapipe", "landmarker", "ort", "model", "session"] as const;
    const fractions = stages.map((stage) => setupFraction({ stage }));
    expect(setupFraction(null)).toBe(0);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1]);
    }
    expect(setupFraction({ stage: "model", loaded: 10, total: 20 })).toBeGreaterThan(
      setupFraction({ stage: "model" }),
    );
    expect(setupFraction({ stage: "ready" })).toBe(1);
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

    const face = displayElement.querySelector("#saccade-preview-face");
    expect(face.textContent).toBe("Looking for your face…");
    const distance = displayElement.querySelector("#saccade-preview-distance");
    const lighting = displayElement.querySelector("#saccade-preview-lighting");
    expect(distance.textContent).toBe("Distance: checking…");
    expect(lighting.textContent).toBe("Lighting: checking…");
    // frame rate and backend are for researchers, and hidden unless asked for
    expect(displayElement.querySelector("#saccade-preview-diagnostics")).toBeNull();

    extension.tracker.emit(
      makeFrame({ faceFound: true, fps: 29.5, quality: quality(0.1, 10, 30) }),
    );
    expect(button.disabled).toBe(false);
    expect(face.textContent).toBe("Face found");
    expect(face.className).toBe("saccade-face-yes");
    expect(distance.textContent).toBe("Distance: move a little closer to the camera");
    expect(distance.className).toContain("saccade-feedback-bad");
    expect(lighting.textContent).toMatch(/^Lighting: too dark/);

    extension.tracker.emit(makeFrame({ faceFound: false, fps: 29.5 }));
    expect(face.textContent).toBe("Looking for your face…");
    expect(distance.textContent).toBe("Distance: checking…");
    for (let i = 0; i < 30; i++) {
      extension.tracker.emit(
        makeFrame({ faceFound: true, fps: 29.5, quality: quality(0.2, 30, 110) }),
      );
    }
    expect(distance.textContent).toBe("Distance: good");
    expect(distance.className).toContain("saccade-feedback-good");
    expect(lighting.textContent).toBe("Lighting: good");

    await clickTarget(button);
    await expectFinished();

    const data = getData().values()[0];
    expect(data.face_detected).toBe(true);
    expect(data.fps).toBeCloseTo(29.5);
    expect(data.backend).toBe("webgpu");
    expect(data.interocular_distance).toBeCloseTo(0.2, 4);
    expect(data.eye_contrast).toBeCloseTo(30, 2);
    expect(data.eye_brightness).toBeCloseTo(110, 2);
    expect(data.distance_feedback).toBe("good");
    expect(data.lighting_feedback).toBe("good");
    expect(typeof data.load_time).toBe("number");
    expect(typeof data.rt).toBe("number");
    expect(extension.hideVideo).toHaveBeenCalled();
  });

  it("shows the frame rate and backend when show_diagnostics is set", async () => {
    const jsPsych = setup();
    const { displayElement } = await startTimeline(
      [{ type: SaccadePreviewPlugin, show_diagnostics: true }],
      jsPsych,
    );
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    await flushPromises();

    expect(displayElement.querySelector("#saccade-preview-diagnostics")).not.toBeNull();
    expect(displayElement.querySelector("#saccade-preview-backend").textContent).toBe("webgpu");
    extension.tracker.emit(makeFrame({ faceFound: true, fps: 29.5 }));
    expect(displayElement.querySelector("#saccade-preview-fps").textContent).toBe("29.5 fps");
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
    expect(displayElement.querySelector("#saccade-preview-feedback")).not.toBeNull();

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
    const data = getData().values()[0];
    expect(data.face_detected).toBe(false);
    expect(data.interocular_distance).toBeNull();
    expect(data.distance_feedback).toBeNull();
  });

  it("shows the setup progress while the tracker loads", async () => {
    const jsPsych = setup();
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    // Hold init open so the loading screen stays on display for the assertions.
    let finishStart: () => void;
    extension.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = () => {
            extension.tracker.start();
            resolve();
          };
        }),
    );

    const { displayElement, expectFinished } = await startTimeline(
      [{ type: SaccadePreviewPlugin }],
      jsPsych,
    );
    await flushPromises();

    const bar = displayElement.querySelector<HTMLElement>("#saccade-preview-progress-bar");
    const label = displayElement.querySelector<HTMLElement>("#saccade-preview-progress-label");
    expect(bar).not.toBeNull();
    expect(label.textContent).toBe("Starting…");

    extension.emitProgress({ stage: "model", loaded: 12.3e6, total: 20.6e6 });
    expect(label.textContent).toBe("Downloading the eye tracker (12.3 of 20.6 MB)…");
    expect(parseFloat(bar.style.width)).toBeGreaterThan(0);
    expect(parseFloat(bar.style.width)).toBeLessThan(100);

    finishStart();
    await flushPromises();

    // The preview replaces the loading screen, and later reports go nowhere.
    expect(displayElement.querySelector("#saccade-preview-progress-bar")).toBeNull();
    extension.emitProgress({ stage: "ready" });

    const button = displayElement.querySelector<HTMLButtonElement>("#saccade-preview-continue");
    extension.tracker.emit(makeFrame({ faceFound: true }));
    await clickTarget(button);
    await expectFinished();
  });

  it("shows a plain message when show_progress is false", async () => {
    const jsPsych = setup();
    const { displayElement, expectFinished } = await startTimeline(
      [{ type: SaccadePreviewPlugin, show_progress: false, require_face: false }],
      jsPsych,
    );
    await flushPromises();

    expect(displayElement.querySelector("#saccade-preview-progress-bar")).toBeNull();
    await clickTarget(displayElement.querySelector("#saccade-preview-continue"));
    await expectFinished();
  });

  it("shows an error message when the camera cannot be started", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const jsPsych = setup();
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    extension.start.mockRejectedValueOnce(new Error("NotAllowedError"));

    const { getHTML } = await startTimeline([{ type: SaccadePreviewPlugin }], jsPsych);
    await flushPromises();

    expect(getHTML()).toMatch(/eye tracker couldn't start/);
    expect(getHTML()).toMatch(/permission to use your camera/);
    errorSpy.mockRestore();
  });

  it("says so when the browser has no WebGL, rather than blaming the camera", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const jsPsych = setup();
    const extension = jsPsych.extensions.saccade as unknown as StubSaccadeExtension;
    const noWebGL = Object.assign(new Error("saccade.js needs WebGL"), {
      name: "WebGLUnavailableError",
    });
    extension.start.mockRejectedValueOnce(noWebGL);

    const { getHTML } = await startTimeline([{ type: SaccadePreviewPlugin }], jsPsych);
    await flushPromises();

    expect(getHTML()).toMatch(/graphics features \(WebGL\)/);
    expect(getHTML()).not.toMatch(/permission to use your camera/);
    errorSpy.mockRestore();
  });
});
