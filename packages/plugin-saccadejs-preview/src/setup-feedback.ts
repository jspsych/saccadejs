import type { FrameQuality } from "@saccadejs/core";

/** Whether the participant is at a good distance, or which way they should move. */
export type DistanceStatus = "good" | "closer" | "farther";

/** Whether the eyes are lit well enough, or what seems to be wrong: too dark, washed out, or
 * low in contrast at an ordinary brightness. */
export type LightingStatus = "good" | "dark" | "bright" | "flat";

export interface SetupThresholds {
  minInterocularDistance: number;
  maxInterocularDistance: number;
  minEyeContrast: number;
}

/** Frames averaged for each reading: about a third of a second at a typical webcam's 30 fps.
 * Long enough to steady the advice, short enough that it follows the participant's moves. */
const WINDOW = 10;

/** Mean eye brightness (0–255) below which low contrast is put down to the room being too dark,
 * and above which to the eyes being washed out. About the 5th and 95th percentiles of the
 * training participants. */
const DARK = 45;
const BRIGHT = 170;

/** How far past a threshold a reading must come back before a warning clears, so a reading
 * that sits on a threshold does not flip the advice back and forth. */
const HYSTERESIS = 0.05;

/**
 * Turns per-frame measures of the recording conditions into steady advice. Each measure is
 * averaged over the last third of a second or so, and a warning, once given, needs the
 * reading to come back a little past its threshold before it clears.
 */
export class SetupFeedback {
  private iod: number[] = [];
  private contrast: number[] = [];
  private brightness: number[] = [];

  distance: DistanceStatus | null = null;
  lighting: LightingStatus | null = null;

  constructor(private thresholds: SetupThresholds) {}

  /** Adds one frame's measures. `null` (no face, or no crop) leaves the readings as they were. */
  update(quality: FrameQuality | null): void {
    if (!quality) return;
    push(this.iod, quality.interocularDistance);
    push(this.contrast, quality.eyeContrast);
    push(this.brightness, quality.eyeBrightness);
    this.distance = this.distanceStatus(this.interocularDistance);
    this.lighting = this.lightingStatus(this.eyeContrast, this.eyeBrightness);
  }

  get interocularDistance(): number | null {
    return mean(this.iod);
  }

  get eyeContrast(): number | null {
    return mean(this.contrast);
  }

  get eyeBrightness(): number | null {
    return mean(this.brightness);
  }

  private distanceStatus(iod: number): DistanceStatus {
    const { minInterocularDistance: min, maxInterocularDistance: max } = this.thresholds;
    const was = this.distance;
    const low = was === "closer" ? min * (1 + HYSTERESIS) : min;
    const high = was === "farther" ? max * (1 - HYSTERESIS) : max;
    if (iod < low) return "closer";
    if (iod > high) return "farther";
    return "good";
  }

  private lightingStatus(contrast: number, brightness: number): LightingStatus {
    const min = this.thresholds.minEyeContrast;
    const warned = this.lighting !== null && this.lighting !== "good";
    if (contrast >= (warned ? min * (1 + HYSTERESIS) : min)) return "good";
    if (brightness < DARK) return "dark";
    if (brightness > BRIGHT) return "bright";
    return "flat";
  }
}

function push(values: number[], value: number): void {
  if (!Number.isFinite(value)) return;
  values.push(value);
  if (values.length > WINDOW) values.shift();
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** What the participant reads for each distance status. `null` is no face yet. */
export function distanceText(status: DistanceStatus | null): string {
  switch (status) {
    case "good":
      return "Distance: good";
    case "closer":
      return "Distance: move a little closer to the camera";
    case "farther":
      return "Distance: move back a little";
    default:
      return "Distance: checking…";
  }
}

/** What the participant reads for each lighting status. `null` is no face yet. */
export function lightingText(status: LightingStatus | null): string {
  switch (status) {
    case "good":
      return "Lighting: good";
    case "dark":
      return "Lighting: too dark. Add light in front of you, such as a lamp or a window";
    case "bright":
      return "Lighting: too bright. Move out of any strong light shining on your face";
    case "flat":
      return "Lighting: your eyes are hard to make out. Face a lamp or window, with no bright light behind you";
    default:
      return "Lighting: checking…";
  }
}
