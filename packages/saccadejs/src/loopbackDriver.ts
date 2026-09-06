// Screen -> webcam timing loopback: the DOM half.
//
// The browser can stamp a gaze sample with the camera frame's `captureTime`, but two physical
// lags stay invisible to JS: display lag (rAF flip -> photons leaving the panel) and camera lag
// (photons -> `captureTime`). Their sum is the constant to subtract from a sample's timestamp
// to line it up with a stimulus onset. This driver flashes a full-viewport panel on a sparse
// (no-flicker) schedule, records the camera's whole-frame luminance per frame, and hands both
// to the edge-difference estimator in ./loopback.
//
// Sparse, not flickering: levels are held 0.5-1 s, so at most one flash per second — a third
// of the WCAG 2.3.1 limit. The timing information is in the edges, not in the rate.

import type { Flip, LagResult, LumSample } from "./loopback";
import {
  estimateLagEdges,
  intervalStats,
  seededRandom,
  sparseSchedule,
  splitHalves,
} from "./loopback";
import type { FrameTime } from "./pipeline";
import type { SaccadeTracker } from "./tracker";

/** D(tau) is normalised so 1.0 = every edge's full luminance jump was captured. */
const MIN_PEAK_D = 0.5;
/** One camera frame at 30 fps: the plateau must be narrower to have sub-frame resolution. */
const MAX_PLATEAU_WIDTH_MS = 34;
/** With this many edges per half the estimate is well determined, so hold it to 8 ms. */
const DENSE_HALF_MIN_EDGES = 15;
const MAX_HALF_DISAGREEMENT_DENSE_MS = 8;
const MAX_HALF_DISAGREEMENT_MS = 20;
/** Below this many luminance samples on a clock, that clock is not analysed at all. */
const MIN_SAMPLES = 10;
/** Below this many, the halves are not split (each half would be noise). */
const MIN_SAMPLES_FOR_HALVES = 40;

export interface LoopbackOptions {
  durationMs?: number;
  gapMinMs?: number;
  gapMaxMs?: number;
  /** [dark, light] CSS colours. Default full contrast; ["#333", "#ccc"] is the gentle option. */
  levels?: [string, string];
  seed?: number;
  /** Where to draw. Default: a fixed full-viewport div appended to document.body. */
  container?: HTMLElement;
  onProgress?: (fractionDone: number) => void;
}

export interface LoopbackResult {
  /** Plateau center on the captureTime clock: display lag + camera lag, in ms. */
  lagMs: number;
  /** Width of the plateau of lags consistent with every edge — the uncertainty. */
  plateauWidthMs: number;
  peakD: number;
  nEdges: number;
  halves: { first: number; second: number };
  cameraPeriodMs: number;
  cameraJitterMs: number;
  droppedFrames: number;
  rafPeriodMs: number;
  rafMaxMs: number;
  clockSource: FrameTime["source"];
  verdict: "OK" | "INCONCLUSIVE" | "UNRELIABLE";
  reason: string | null;
  flips: { t: number; level: number }[];
  samples: { t: number; lum: number }[];
  seed: number;
  settings: Required<Pick<LoopbackOptions, "durationMs" | "gapMinMs" | "gapMaxMs" | "levels">>;
}

interface VideoFrameMeta {
  captureTime?: number;
  receiveTime?: number;
  presentedFrames?: number;
}

interface RvfcVideoElement {
  requestVideoFrameCallback(cb: (now: number, meta: VideoFrameMeta) => void): number;
  cancelVideoFrameCallback(handle: number): void;
}

function asRvfc(v: HTMLVideoElement): RvfcVideoElement | null {
  const c = v as unknown as Partial<RvfcVideoElement>;
  return typeof c.requestVideoFrameCallback === "function" ? (c as RvfcVideoElement) : null;
}

interface CamSample {
  now: number;
  captureTime: number | null;
  receiveTime: number | null;
  presentedFrames: number | null;
  lum: number;
}

interface Capture {
  flips: Flip[];
  rafTimestamps: number[];
  samples: CamSample[];
}

function makePanel(background: string): HTMLDivElement {
  const panel = document.createElement("div");
  panel.setAttribute("data-saccade-loopback", "");
  const s = panel.style;
  s.position = "fixed";
  s.left = "0";
  s.top = "0";
  s.width = "100vw";
  s.height = "100vh";
  s.margin = "0";
  s.zIndex = "2147483647";
  s.background = background;
  return panel;
}

/** Run the schedule and the camera sampler concurrently until the duration elapses (or Esc). */
function capture(
  panel: HTMLElement,
  video: HTMLVideoElement,
  sampleLum: () => number,
  times: number[],
  levels: [string, string],
  durationMs: number,
  onProgress?: (f: number) => void,
): Promise<Capture> {
  const flips: Flip[] = [];
  const rafTimestamps: number[] = [];
  const samples: CamSample[] = [];
  const rvfc = asRvfc(video);
  let running = true;

  return new Promise<Capture>((resolve) => {
    let rafCount = 0;
    let symbolIdx = 0;
    let level = -1;
    let t0 = -1;
    let flipHandle = 0;
    let camHandle = 0;

    function onKey(ev: KeyboardEvent): void {
      // Escape aborts early — a way out of the flashing without waiting it out.
      if (ev.key === "Escape") finish();
    }

    function finish(): void {
      if (!running) return;
      running = false;
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(flipHandle);
      if (rvfc) rvfc.cancelVideoFrameCallback(camHandle);
      else cancelAnimationFrame(camHandle);
      resolve({ flips, rafTimestamps, samples });
    }

    // The rAF timestamp is the time reference for a flip; the photons for that paint leave the
    // panel some time later, and measuring exactly that delay is the point.
    function setLevel(next: number, ts: number): void {
      if (next === level) return;
      level = next;
      panel.style.background = levels[level];
      flips.push({ t: ts, level });
    }

    function flipFrame(ts: number): void {
      if (!running) return;
      if (t0 < 0) t0 = ts;
      rafTimestamps.push(ts);
      // The first frame pins level 0 at t0 so the stimulus is defined from the start; then
      // toggle at each scheduled time (relative to t0).
      if (rafCount === 0) setLevel(0, ts);
      while (symbolIdx < times.length && ts - t0 >= times[symbolIdx]) {
        setLevel(1 - level, ts);
        symbolIdx++;
      }
      rafCount++;
      const done = (ts - t0) / durationMs;
      onProgress?.(done > 1 ? 1 : done);
      if (ts - t0 >= durationMs) {
        finish();
        return;
      }
      flipHandle = requestAnimationFrame(flipFrame);
    }

    function grab(now: number, meta: VideoFrameMeta | null): void {
      samples.push({
        now,
        captureTime: meta?.captureTime ?? null,
        receiveTime: meta?.receiveTime ?? null,
        presentedFrames: meta?.presentedFrames ?? null,
        lum: sampleLum(),
      });
    }

    function camFrame(now: number, meta: VideoFrameMeta): void {
      if (!running) return;
      grab(now, meta);
      camHandle = rvfc!.requestVideoFrameCallback(camFrame);
    }

    function camRaf(ts: number): void {
      if (!running) return;
      grab(ts, null);
      camHandle = requestAnimationFrame(camRaf);
    }

    window.addEventListener("keydown", onKey);
    if (rvfc) camHandle = rvfc.requestVideoFrameCallback(camFrame);
    else camHandle = requestAnimationFrame(camRaf);
    flipHandle = requestAnimationFrame(flipFrame);
  });
}

function pick(samples: CamSample[], key: "captureTime" | "receiveTime" | "now"): LumSample[] {
  const out: LumSample[] = [];
  for (const s of samples) {
    const t = key === "now" ? s.now : s[key];
    if (t === null || !Number.isFinite(t)) continue;
    out.push({ t, lum: s.lum });
  }
  return out;
}

function droppedFrames(samples: CamSample[]): number {
  let dropped = 0;
  let prev: number | null = null;
  for (const s of samples) {
    if (s.presentedFrames === null) continue;
    if (prev !== null) {
      const gap = s.presentedFrames - prev - 1;
      if (gap > 0) dropped += gap;
    }
    prev = s.presentedFrames;
  }
  return dropped;
}

function num(v: number, d = 2): string {
  return Number.isFinite(v) ? v.toFixed(d) : "n/a";
}

/**
 * The verdict is about whether the *number* can be trusted, not about whether the setup is
 * good: a weak peak means most edges were not seen cleanly, a wide plateau means too few
 * edges pinned the lag down, and disagreeing halves mean it drifted during the run.
 */
function verdictFor(
  primary: LagResult | null,
  halves: { first: LagResult; second: LagResult } | null,
  nEdges: number,
): { verdict: LoopbackResult["verdict"]; reason: string | null } {
  if (!primary) {
    return { verdict: "INCONCLUSIVE", reason: "no usable camera samples" };
  }
  if (nEdges < 2) {
    return { verdict: "INCONCLUSIVE", reason: `only ${nEdges} luminance edge(s); run longer` };
  }
  const reasons: string[] = [];
  if (!(primary.peakCorr >= MIN_PEAK_D)) {
    reasons.push(`weak peak (D=${num(primary.peakCorr, 3)} < ${MIN_PEAK_D})`);
  }
  // With sparse edges the correlation decays slowly away from the peak, so a second-peak ratio
  // says nothing; what matters is that the edges intersect to a window narrower than a frame.
  if (!(primary.plateau.widthMs <= MAX_PLATEAU_WIDTH_MS)) {
    reasons.push(
      `plateau ${num(primary.plateau.widthMs, 1)} ms wide (> ${MAX_PLATEAU_WIDTH_MS}; too few edges)`,
    );
  }
  if (halves) {
    const gap = Math.abs(halves.first.plateau.centerMs - halves.second.plateau.centerMs);
    // 20 ms is the estimator's own tail on ~5 s of data. A long run puts far more edges in each
    // half, so at 15+ edges each a 20 ms disagreement is a real inconsistency, not noise.
    const perHalf = Math.floor(nEdges / 2);
    const tol =
      perHalf >= DENSE_HALF_MIN_EDGES ? MAX_HALF_DISAGREEMENT_DENSE_MS : MAX_HALF_DISAGREEMENT_MS;
    if (!(gap <= tol)) {
      reasons.push(`halves disagree by ${num(gap)} ms (> ${tol} ms at ${perHalf} edges/half)`);
    }
  } else {
    reasons.push("no half-split check (too few camera samples)");
  }
  return reasons.length === 0
    ? { verdict: "OK", reason: null }
    : { verdict: "UNRELIABLE", reason: reasons.join("; ") };
}

/**
 * Run the no-flicker loopback using the tracker's video. The tracker must be initialised; it
 * may be running, in which case gaze processing is paused for the duration and resumed after
 * (the camera cannot feed two consumers at 30 fps without one of them starving the other).
 */
export async function runLoopback(
  tracker: SaccadeTracker,
  opts: LoopbackOptions = {},
): Promise<LoopbackResult> {
  const durationMs = opts.durationMs ?? 15000;
  const gapMinMs = opts.gapMinMs ?? 500;
  const gapMaxMs = opts.gapMaxMs ?? 1000;
  const levels: [string, string] = opts.levels ?? ["#000", "#fff"];
  const seed = opts.seed ?? (Math.random() * 2 ** 32) >>> 0;
  const settings = { durationMs, gapMinMs, gapMaxMs, levels };

  const times = sparseSchedule(durationMs, gapMinMs, gapMaxMs, seededRandom(seed));

  const wasRunning = tracker.running;
  tracker.stop();

  const container = opts.container ?? document.body;
  const panel = makePanel(levels[0]);
  container.appendChild(panel);

  let cap: Capture;
  try {
    cap = await capture(
      panel,
      tracker.video,
      () => tracker.sampleLuminance(),
      times,
      levels,
      durationMs,
      opts.onProgress,
    );
  } finally {
    panel.remove();
    if (wasRunning) tracker.start();
  }

  // Level changes, not flips: the first flip only pins the starting level.
  let nEdges = 0;
  for (let i = 1; i < cap.flips.length; i++) {
    if (cap.flips[i].level !== cap.flips[i - 1].level) nEdges++;
  }

  // captureTime is the clock the tracker stamps gaze samples with, so it drives the verdict;
  // the others are only a fallback for browsers that do not expose it.
  let primary: LagResult | null = null;
  let primarySamples: LumSample[] = [];
  let clockSource: FrameTime["source"] = "callback";
  for (const key of ["captureTime", "receiveTime", "now"] as const) {
    const lum = pick(cap.samples, key);
    if (lum.length < MIN_SAMPLES) continue;
    primary = estimateLagEdges(cap.flips, lum);
    primarySamples = lum;
    clockSource = key === "now" ? "callback" : key;
    break;
  }

  const halvesRaw =
    primary && primarySamples.length >= MIN_SAMPLES_FOR_HALVES
      ? splitHalves(cap.flips, primarySamples, {}, estimateLagEdges)
      : null;

  const camStats = intervalStats(primarySamples.map((s) => s.t));
  const rafStats = intervalStats(cap.rafTimestamps);
  const { verdict, reason } = verdictFor(primary, halvesRaw, nEdges);

  return {
    lagMs: primary ? primary.plateau.centerMs : NaN,
    plateauWidthMs: primary ? primary.plateau.widthMs : NaN,
    peakD: primary ? primary.peakCorr : NaN,
    nEdges,
    halves: {
      first: halvesRaw ? halvesRaw.first.plateau.centerMs : NaN,
      second: halvesRaw ? halvesRaw.second.plateau.centerMs : NaN,
    },
    cameraPeriodMs: camStats.mean,
    cameraJitterMs: camStats.sd,
    droppedFrames: droppedFrames(cap.samples),
    rafPeriodMs: rafStats.mean,
    rafMaxMs: rafStats.max,
    clockSource,
    verdict,
    reason,
    flips: cap.flips.map((f) => ({ t: f.t, level: f.level })),
    samples: primarySamples.map((s) => ({ t: s.t, lum: s.lum })),
    seed,
    settings,
  };
}
