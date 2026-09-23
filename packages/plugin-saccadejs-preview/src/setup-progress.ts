// How the tracker's load progress is turned into a bar and a line of text.
//
// Kept out of `index.ts` because the package's rollup build emits a single default export, so
// the plugin's entry point cannot export anything else. The tests import these from here.

import type { SaccadeProgress, SaccadeProgressStage } from "@saccadejs/core";

/**
 * The load stages `SaccadeTracker.init()` reports, in the order it walks them, with the rough
 * share of the wait each one takes. Only the eye model reports bytes, and it is most of the
 * wait, so it gets most of the bar. The weights matter to the bar and nothing else; a stage the
 * tracker skips (a page-supplied stream or model) simply never arrives.
 */
// The labels are read by participants, not researchers: they say what the participant is
// waiting for, not which library is loading. The three loads in the middle share one label
// because the difference between them means nothing to someone waiting; the bar still steps.
const SETUP_STAGES: { stage: SaccadeProgressStage; label: string; weight: number }[] = [
  { stage: "camera", label: "Waiting for permission to use your camera", weight: 1 },
  { stage: "mediapipe", label: "Loading", weight: 2 },
  { stage: "landmarker", label: "Loading", weight: 3 },
  { stage: "ort", label: "Loading", weight: 2 },
  { stage: "model", label: "Downloading the eye tracker", weight: 10 },
  { stage: "session", label: "Almost ready", weight: 2 },
];
const SETUP_TOTAL_WEIGHT = SETUP_STAGES.reduce((total, s) => total + s.weight, 0);

const mb = (n: number): string => (n / 1e6).toFixed(1);

/** Fraction of the whole setup that `p` represents, 0–1. */
export function setupFraction(p: SaccadeProgress | null): number {
  if (!p) return 0;
  if (p.stage === "ready") return 1;
  let before = 0;
  for (const s of SETUP_STAGES) {
    if (s.stage === p.stage) {
      const inner = p.total && p.loaded != null ? Math.min(1, p.loaded / p.total) : 0;
      return (before + s.weight * inner) / SETUP_TOTAL_WEIGHT;
    }
    before += s.weight;
  }
  return before / SETUP_TOTAL_WEIGHT;
}

/** What to say about `p`, e.g. `Downloading the eye tracker (12.3 of 20.6 MB)…`. */
export function setupLabel(p: SaccadeProgress | null): string {
  if (!p) return "Starting…";
  if (p.stage === "ready") return "Ready";
  const base = SETUP_STAGES.find((s) => s.stage === p.stage)?.label ?? "Loading";
  if (p.stage !== "model" || p.loaded == null) return `${base}…`;
  return p.total
    ? `${base} (${mb(p.loaded)} of ${mb(p.total)} MB)…`
    : `${base} (${mb(p.loaded)} MB)…`;
}
