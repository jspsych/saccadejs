/**
 * Runtime stub for the `saccadejs` core package.
 *
 * `jest.config.cjs` maps `saccadejs` onto this file so the plugin's tests never flash the real
 * screen or read a real webcam. `runLoopback` is a jest mock; tests set its resolved value.
 */

/** A plausible `LoopbackResult`; override anything the test cares about. */
export function makeLoopbackResult(overrides: Record<string, any> = {}) {
  return {
    lagMs: 82,
    plateauWidthMs: 20,
    peakD: 0.85,
    nEdges: 21,
    halves: { first: 80, second: 84 },
    cameraPeriodMs: 33.3,
    cameraJitterMs: 1.2,
    droppedFrames: 0,
    rafPeriodMs: 16.7,
    rafMaxMs: 20,
    clockSource: "captureTime",
    verdict: "OK",
    reason: null,
    flips: [],
    samples: [],
    seed: 1,
    settings: { durationMs: 15000, gapMinMs: 500, gapMaxMs: 1000, levels: ["#000", "#fff"] },
    ...overrides,
  };
}

export const runLoopback = jest.fn(async (_tracker: any, opts: any = {}) => {
  opts.onProgress?.(1);
  return makeLoopbackResult({ settings: { ...makeLoopbackResult().settings, ...opts } });
});
