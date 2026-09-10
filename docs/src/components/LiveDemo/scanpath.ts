/**
 * The scanpath figures the live demo shows after its two viewing trials.
 *
 * Nothing here is part of saccade.js. It is the analysis an experimenter would write over a
 * trial's `saccade_data`: group the per-frame samples into fixations, then draw them over the
 * stimulus. It lives beside the demo rather than in a package because every lab draws this
 * figure slightly differently, and the library has no business deciding which way is right.
 *
 * The drawing follows the saccade.js mark: circles for fixations with radius encoding dwell,
 * lines for the saccades between them, and colour running from the start of the trial to the
 * end along the same four brand stops. A visitor who has looked at the logo has already been
 * told how to read this.
 */

// ---------------------------------------------------------------------------------------
// fixation detection

/** One row of `saccade_data`: viewport pixels, and ms since the trial started. */
export interface Sample {
  x: number;
  y: number;
  t: number;
}

/** A `saccade_targets` entry, or any other viewport-space box. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Fixation {
  /** Centroid, in the same viewport pixels as the samples it came from. */
  x: number;
  y: number;
  start: number;
  end: number;
  duration: number;
  /** How many samples went into it. */
  n: number;
}

/** Sum of the x and y ranges over `samples[from..to]` — the I-DT dispersion measure. */
function dispersionOf(samples: Sample[], from: number, to: number): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = from; i <= to; i++) {
    const s = samples[i];
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  return maxX - minX + (maxY - minY);
}

function summarise(samples: Sample[], from: number, to: number): Fixation {
  let sumX = 0;
  let sumY = 0;
  for (let i = from; i <= to; i++) {
    sumX += samples[i].x;
    sumY += samples[i].y;
  }
  const n = to - from + 1;
  return {
    x: sumX / n,
    y: sumY / n,
    start: samples[from].t,
    end: samples[to].t,
    duration: samples[to].t - samples[from].t,
    n,
  };
}

/**
 * Group samples into fixations with I-DT (Salvucci & Goldberg 2000): walk a window forward
 * while everything in it stays within `dispersion` of everything else, and emit it once it has
 * lasted `minDuration`.
 *
 * I-DT rather than a velocity threshold because a webcam runs at 30 Hz. Velocity-based
 * detection wants samples closer together than a saccade is long; at 33 ms per frame a saccade
 * is usually one sample or none, so there is no velocity peak to threshold. Dispersion needs
 * only the positions to sit still, which they do whether or not the flight between them was
 * ever sampled.
 *
 * `dispersion` should be generous compared with a lab tracker's — the caller passes something
 * scaled to the precision the validation trial measured on this participant, not to a degree of
 * visual angle.
 */
export function detectFixations(
  samples: Sample[],
  { dispersion, minDuration }: { dispersion: number; minDuration: number },
): Fixation[] {
  const fixations: Fixation[] = [];
  let start = 0;

  while (start < samples.length) {
    // Grow the window to the minimum duration first: a window shorter than that cannot be a
    // fixation however tightly its samples cluster.
    let end = start;
    while (end + 1 < samples.length && samples[end].t - samples[start].t < minDuration) end++;
    if (samples[end].t - samples[start].t < minDuration) break; // out of data

    if (dispersionOf(samples, start, end) > dispersion) {
      // Too spread out to be a fixation. Drop the oldest sample and try again — this is what
      // makes the algorithm skip over the samples taken mid-saccade.
      start++;
      continue;
    }

    while (end + 1 < samples.length && dispersionOf(samples, start, end + 1) <= dispersion) end++;
    fixations.push(summarise(samples, start, end));
    start = end + 1;
  }

  return fixations;
}

// ---------------------------------------------------------------------------------------
// drawing

/** The mark's four stops, early to late. See `SaccadeMark`. */
const RAMP: Array<[number, number, number]> = [
  [0x00, 0x68, 0x38],
  [0x13, 0xb2, 0x4b],
  [0xf7, 0x8f, 0x1e],
  [0xee, 0x45, 0x23],
];

/** The ramp colour at `u` in 0–1, linearly between stops. */
function rampColor(u: number, alpha = 1): string {
  const clamped = Math.max(0, Math.min(1, u));
  const scaled = clamped * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const channel = (c: number) => Math.round(RAMP[i][c] + (RAMP[i + 1][c] - RAMP[i][c]) * f);
  return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${alpha})`;
}

/**
 * Radii and line weight as fractions of the stimulus's shorter side, so the figure looks the
 * same on a laptop and on a 27-inch monitor — and the same again at the half size the two
 * figures on the comparison screen are drawn at.
 *
 * Deliberately small. Ten seconds of viewing is twenty-odd fixations, and at any radius large
 * enough to carry a number inside it the figure stops being a picture of a painting and becomes
 * a picture of circles. The order is carried by colour instead.
 */
const RADIUS_MIN = 0.011;
const RADIUS_MAX = 0.032;
const STROKE = 0.0045;

export interface DrawOptions {
  /** Where the stimulus was on screen while the samples were recorded. */
  from: Rect;
  /** Size of the canvas, in CSS pixels — the stimulus is assumed to fill it. */
  width: number;
  height: number;
}

/**
 * Draw fixations and saccades onto a transparent canvas sized to sit exactly over the stimulus.
 *
 * Samples are mapped through the stimulus rather than through the viewport, so the figure is
 * correct even though the window may have been resized, or the page scrolled, between the trial
 * and the figure. Anything that falls outside the stimulus is clipped by the canvas, which is
 * the honest thing to do: those are moments the participant spent looking off the picture.
 */
export function drawScanpath(
  canvas: HTMLCanvasElement,
  fixations: Fixation[],
  samples: Sample[],
  { from, width, height }: DrawOptions,
): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!from.width || !from.height) return;

  const toX = (x: number) => ((x - from.left) / from.width) * width;
  const toY = (y: number) => ((y - from.top) / from.height) * height;

  const unit = Math.min(width, height);
  const stroke = Math.max(1.5, STROKE * unit);

  // With no fixations there is still something true to show: the samples themselves. This is
  // what a participant who never held still long enough gets, rather than an empty picture.
  if (fixations.length === 0) {
    for (const s of samples) {
      ctx.beginPath();
      ctx.arc(toX(s.x), toY(s.y), stroke, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(20, 20, 20, 0.45)";
      ctx.fill();
    }
    return;
  }

  const first = fixations[0].start;
  const span = Math.max(1, fixations[fixations.length - 1].end - first);
  /** Where a fixation sits between the start of the trial and the end, for its colour. */
  const at = (f: Fixation) => (f.start - first) / span;

  const durations = fixations.map((f) => f.duration);
  const shortest = Math.min(...durations);
  const longest = Math.max(...durations);
  const radiusOf = (f: Fixation) => {
    // Area with dwell, so a fixation twice as long looks twice as big rather than four times.
    const u = longest > shortest ? Math.sqrt((f.duration - shortest) / (longest - shortest)) : 0.5;
    return (RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * u) * unit;
  };

  // Saccades first, so the circles sit on top of their own ends. Each is stroked twice: a dark
  // halo underneath keeps the path readable over the light parts of a painting.
  ctx.lineCap = "round";
  for (let i = 1; i < fixations.length; i++) {
    const a = fixations[i - 1];
    const b = fixations[i];
    ctx.beginPath();
    ctx.moveTo(toX(a.x), toY(a.y));
    ctx.lineTo(toX(b.x), toY(b.y));
    ctx.lineWidth = stroke * 2;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
    ctx.stroke();
    ctx.lineWidth = stroke * 0.8;
    ctx.strokeStyle = rampColor(at(a), 0.85);
    ctx.stroke();
  }

  for (const f of fixations) {
    const x = toX(f.x);
    const y = toY(f.y);
    const r = radiusOf(f);

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rampColor(at(f), 0.7);
    ctx.fill();
    ctx.lineWidth = stroke * 0.8;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.stroke();
  }
}
