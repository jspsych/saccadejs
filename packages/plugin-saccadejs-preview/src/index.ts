import type SaccadeExtension from "@saccadejs/extension";
import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";
import type { SaccadeProgress, TrackerFrame } from "@saccadejs/core";

import { version } from "../package.json";
import { setupFraction, setupLabel } from "./setup-progress";

/** Dimensions of the eye crop the model sees. */
const EYE_W = 144;
const EYE_H = 36;

const STYLE_ID = "saccade-preview-style";

const CSS = `
#saccade-preview-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px 16px;
  font-family: inherit;
}
#saccade-preview-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
#saccade-preview-video {
  display: block;
  transform: scaleX(-1);
  background: #000;
  border-radius: 6px;
}
#saccade-preview-crop {
  display: block;
  image-rendering: pixelated;
  background: #000;
  border-radius: 4px;
}
#saccade-preview-status {
  display: flex;
  gap: 18px;
  align-items: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}
#saccade-preview-status .saccade-face-yes { color: #15803d; font-weight: 600; }
#saccade-preview-status .saccade-face-no { color: #b91c1c; font-weight: 600; }
#saccade-preview-instructions { max-width: 640px; }
#saccade-preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 16px;
  font-family: inherit;
}
#saccade-preview-progress-track {
  width: min(420px, 80vw);
  height: 8px;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.3);
  overflow: hidden;
}
#saccade-preview-progress-bar {
  height: 100%;
  width: 0%;
  border-radius: 4px;
  background: #38bdf8;
  transition: width 150ms linear;
}
#saccade-preview-progress-label { font-size: 14px; }
#saccade-preview-loading-note { font-size: 13px; opacity: 0.75; max-width: 420px; text-align: center; }
.saccade-preview-detail {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  opacity: 0.75;
}
`;

const info = <const>{
  name: "saccade-preview",
  version: version,
  parameters: {
    /** Instructions shown beside the camera preview. */
    instructions: {
      type: ParameterType.HTML_STRING,
      default: `
        <p>Position your head so that the webcam has a good view of your eyes.</p>
        <p>Look directly at the screen and keep your face centered in the preview. It is important
        that you keep your head reasonably still for the rest of the experiment, so take a moment
        now to make your setup comfortable.</p>
        <p>When the face indicator is green, you can continue.</p>`,
    },
    /** Text of the button that ends the trial. */
    button_text: {
      type: ParameterType.STRING,
      default: "Continue",
    },
    /** Whether to show the 144×36 eye crop that the model actually sees, scaled up. */
    show_eye_crop: {
      type: ParameterType.BOOL,
      default: true,
    },
    /** If true, the continue button is enabled only while a face is being found. */
    require_face: {
      type: ParameterType.BOOL,
      default: true,
    },
    /** An escape hatch for `require_face`: after this many milliseconds the continue button is
     * enabled even if no face has ever been found, so a participant whose camera the model cannot
     * cope with is not stuck. `null` waits indefinitely. `face_detected` in the data still
     * reports whether a face was actually being found. */
    face_timeout: {
      type: ParameterType.INT,
      default: null,
    },
    /** Width of the camera preview, in pixels. */
    preview_width: {
      type: ParameterType.INT,
      default: 320,
    },
    /** Whether to show a progress bar and a stage label while the camera, MediaPipe, the
     * face-landmarker, onnxruntime-web and the ~20 MB eye model load. The eye model is the only
     * stage that can report bytes, so it is the only one with a moving bar; the rest step the
     * bar on as they complete. Set `false` for a plain "Starting the camera…" message. */
    show_progress: {
      type: ParameterType.BOOL,
      default: true,
    },
  },
  data: {
    /** How long it took (ms) to get the camera and the models running and produce the first frame.
     * This can be a long time on a slow connection, so it is recorded for troubleshooting. */
    load_time: {
      type: ParameterType.INT,
    },
    /** Whether a face was being found in the camera image at the moment the participant continued. */
    face_detected: {
      type: ParameterType.BOOL,
    },
    /** The tracker's frame rate (frames per second) at the moment the participant continued. */
    fps: {
      type: ParameterType.FLOAT,
    },
    /** The ONNX Runtime execution provider the embedding model is running on: `"webgpu"` or `"wasm"`. */
    backend: {
      type: ParameterType.STRING,
    },
    /** Time in milliseconds from the start of the trial until the participant clicked the button. */
    rt: {
      type: ParameterType.INT,
    },
  },
  // prettier-ignore
  citations: '__CITATIONS__',
};

type Info = typeof info;

/**
 * Starts the saccade.js camera and models, and lets the participant position themselves in front
 * of the webcam. Shows the mirrored camera image, the 144×36 eye crop that the model sees, and a
 * face-found indicator. This is the saccade.js replacement for `webgazer-init-camera`.
 *
 * The `saccade` extension must be registered in `initJsPsych`.
 *
 * @author Josh de Leeuw
 * @see {@link https://saccade.jspsych.org/reference/plugin-preview/ saccade.js: the saccade-preview plugin}
 */
class SaccadePreviewPlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>, on_load: () => void) {
    const extension = this.jsPsych.extensions.saccade as unknown as SaccadeExtension;
    if (!extension) {
      throw new Error(
        "The saccade-preview plugin requires the saccade extension. Add it to initJsPsych: " +
          "initJsPsych({ extensions: [{ type: jsPsychExtensionSaccade }] })",
      );
    }

    let trial_complete: (value?: unknown) => void;

    const start_time = performance.now();
    let load_time: number = null;
    let rt_start: number = null;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeProgress: (() => void) | null = null;
    let faceFound = false;
    let fps: number = null;
    // once the face_timeout has elapsed, later face-less frames must not re-disable the button
    let face_gate_open = false;

    injectStyle();

    const showLoading = () => {
      if (!trial.show_progress) {
        display_element.innerHTML = `<p id="saccade-preview-loading">Starting the camera…</p>`;
        return;
      }
      display_element.innerHTML = `
        <div id="saccade-preview-loading">
          <div id="saccade-preview-progress-track" role="progressbar" aria-valuemin="0"
            aria-valuemax="100" aria-valuenow="0">
            <div id="saccade-preview-progress-bar"></div>
          </div>
          <p id="saccade-preview-progress-label">Starting…</p>
          <p id="saccade-preview-loading-note">The eye model is about 20 MB. It is downloaded
          once and then cached by the browser.</p>
        </div>`;

      const track = display_element.querySelector("#saccade-preview-progress-track") as HTMLElement;
      const bar = display_element.querySelector("#saccade-preview-progress-bar") as HTMLElement;
      const label = display_element.querySelector("#saccade-preview-progress-label") as HTMLElement;

      const render = (p: SaccadeProgress | null) => {
        // The screen is swapped out as soon as init resolves; a late report must not write to
        // elements that are no longer in the display.
        if (!bar.isConnected) return;
        const pct = Math.round(Math.min(1, Math.max(0, setupFraction(p))) * 100);
        bar.style.width = `${pct}%`;
        track.setAttribute("aria-valuenow", String(pct));
        label.textContent = setupLabel(p);
      };

      // Subscribing replays the most recent report, so a tracker that was already loading when
      // the trial started does not show an empty bar.
      unsubscribeProgress = extension.onSetupProgress?.(render) ?? null;
      if (!unsubscribeProgress) render(null);
    };

    showLoading();

    const end_trial = () => {
      unsubscribe?.();
      unsubscribe = null;
      unsubscribeProgress?.();
      unsubscribeProgress = null;
      // This trial borrowed the tracker's <video> for the preview panel. hideVideo() hands it
      // back to the extension's own (hidden, but rendered) container *before* the display is
      // cleared below — otherwise the element is destroyed with the rest of the trial markup
      // and Chrome stops delivering camera frames for the rest of the experiment.
      const video = extension.getTracker().video;
      if (video) {
        // Drop this trial's sizing so the container it goes back to governs it again.
        video.removeAttribute("id");
        video.style.width = "";
        video.style.height = "";
      }
      extension.hideVideo();
      extension.pause();

      const trial_data = {
        load_time: load_time,
        face_detected: faceFound,
        fps: fps,
        backend: extension.getBackend(),
        rt: rt_start === null ? null : Math.round(performance.now() - rt_start),
      };

      display_element.innerHTML = "";
      this.jsPsych.finishTrial(trial_data);
      trial_complete();
    };

    const showTrial = () => {
      load_time = Math.round(performance.now() - start_time);
      rt_start = performance.now();

      const cropStyle = trial.show_eye_crop
        ? `width:${trial.preview_width}px; height:${Math.round(
            (trial.preview_width * EYE_H) / EYE_W,
          )}px;`
        : "display:none;";

      display_element.innerHTML = `
        <div id="saccade-preview-wrapper">
          <div id="saccade-preview-panel">
            <canvas id="saccade-preview-crop" width="${EYE_W}" height="${EYE_H}"
              style="${cropStyle}"></canvas>
            <div id="saccade-preview-status">
              <span>face: <span id="saccade-preview-face" class="saccade-face-no">no</span></span>
              <span id="saccade-preview-fps">– fps</span>
              <span id="saccade-preview-backend">${extension.getBackend() ?? "–"}</span>
            </div>
          </div>
          <div id="saccade-preview-instructions">${trial.instructions}</div>
          <button id="saccade-preview-continue" class="jspsych-btn">${trial.button_text}</button>
        </div>`;

      // Put the live camera element in the panel, above the eye crop.
      const panel = display_element.querySelector("#saccade-preview-panel") as HTMLElement;
      const video = extension.getTracker().video;
      if (video) {
        video.id = "saccade-preview-video";
        video.style.width = `${trial.preview_width}px`;
        video.style.height = "auto";
        panel.insertBefore(video, panel.firstChild);
      }

      const cropCanvas = display_element.querySelector(
        "#saccade-preview-crop",
      ) as HTMLCanvasElement;
      const cropCtx = trial.show_eye_crop ? cropCanvas.getContext("2d") : null;
      const cropImage = cropCtx ? cropCtx.createImageData(EYE_W, EYE_H) : null;

      const faceEl = display_element.querySelector("#saccade-preview-face") as HTMLElement;
      const fpsEl = display_element.querySelector("#saccade-preview-fps") as HTMLElement;
      const backendEl = display_element.querySelector("#saccade-preview-backend") as HTMLElement;
      const button = display_element.querySelector(
        "#saccade-preview-continue",
      ) as HTMLButtonElement;

      button.disabled = !!trial.require_face;
      button.addEventListener("click", end_trial);

      if (trial.require_face && trial.face_timeout !== null) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          face_gate_open = true;
          button.disabled = false;
        }, trial.face_timeout);
      }

      backendEl.textContent = extension.getBackend() ?? "–";

      let tick = 0;
      unsubscribe = extension.getTracker().onFrame((frame: TrackerFrame) => {
        faceFound = frame.faceFound;
        fps = frame.fps;

        if (cropCtx && cropImage && frame.crop && frame.crop.length === EYE_W * EYE_H) {
          const px = cropImage.data;
          for (let i = 0; i < frame.crop.length; i++) {
            const v = frame.crop[i];
            px[i * 4] = v;
            px[i * 4 + 1] = v;
            px[i * 4 + 2] = v;
            px[i * 4 + 3] = 255;
          }
          cropCtx.putImageData(cropImage, 0, 0);
        }

        faceEl.textContent = frame.faceFound ? "yes" : "no";
        faceEl.className = frame.faceFound ? "saccade-face-yes" : "saccade-face-no";
        if (trial.require_face && !face_gate_open) button.disabled = !frame.faceFound;

        if (tick++ % 5 === 0) fpsEl.textContent = `${frame.fps.toFixed(1)} fps`;
      });

      on_load();
    };

    const begin = extension.isInitialized() ? Promise.resolve() : extension.start();

    begin
      .then(() => {
        unsubscribeProgress?.();
        unsubscribeProgress = null;
        extension.resume();
        showTrial();
      })
      .catch((error) => {
        unsubscribeProgress?.();
        unsubscribeProgress = null;
        console.error(error);
        display_element.innerHTML = `
          <p>The experiment cannot continue because the eye tracker failed to start.</p>
          <p>This may be a technical problem, or you may not have given the page permission to use
          your camera.</p>
          <p class="saccade-preview-detail">${escapeHtml(String(error?.message ?? error))}</p>`;
        on_load();
      });

    return new Promise((resolve) => {
      trial_complete = resolve;
    });
  }
}

/** The failure message is put in the display as markup; a message is not trusted as markup. */
function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export default SaccadePreviewPlugin;
