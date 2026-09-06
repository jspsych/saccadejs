import { runLoopback } from "../src/loopbackDriver";
import type { SaccadeTracker } from "../src/tracker";

/**
 * A tracker stand-in whose "camera" reports the panel's current colour, delayed by `lagMs`.
 * That is exactly the signal the real loopback measures, so the driver can be exercised end
 * to end in jsdom — schedule, sampling, estimation and verdict — without a camera.
 */
function loopbackTracker(lagMs: number): { tracker: SaccadeTracker; started: number[] } {
  const history: { t: number; lum: number }[] = [];
  const started: number[] = [];
  let running = false;
  const video = document.createElement("video");
  const tracker = {
    video,
    get running() {
      return running;
    },
    start: () => {
      running = true;
      started.push(performance.now());
    },
    stop: () => {
      running = false;
    },
    sampleLuminance: () => {
      const panel = document.querySelector<HTMLElement>("[data-saccade-loopback]");
      const now = performance.now();
      const white =
        panel?.style.background === "rgb(255, 255, 255)" || panel?.style.background === "#fff";
      history.push({ t: now, lum: white ? 200 : 30 });
      // Report the panel colour as it was `lagMs` ago.
      let lum = history[0].lum;
      for (const h of history) if (h.t <= now - lagMs) lum = h.lum;
      return lum;
    },
  } as unknown as SaccadeTracker;
  return { tracker, started };
}

describe("runLoopback", () => {
  it("draws a full-viewport panel, runs the schedule, and cleans up after itself", async () => {
    const { tracker, started } = loopbackTracker(0);
    tracker.start();
    const progress: number[] = [];
    const res = await runLoopback(tracker, {
      durationMs: 400,
      gapMinMs: 40,
      gapMaxMs: 80,
      seed: 7,
      onProgress: (f) => progress.push(f),
    });

    // The panel is gone and the tracker is running again.
    expect(document.querySelector("[data-saccade-loopback]")).toBeNull();
    expect(tracker.running).toBe(true);
    expect(started.length).toBe(2);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBeLessThanOrEqual(1);

    expect(res.seed).toBe(7);
    expect(res.settings).toEqual({
      durationMs: 400,
      gapMinMs: 40,
      gapMaxMs: 80,
      levels: ["#000", "#fff"],
    });
    expect(res.nEdges).toBeGreaterThan(0);
    expect(res.flips.length).toBe(res.nEdges + 1);
    expect(res.flips[0].level).toBe(0);
    expect(res.samples.length).toBeGreaterThan(0);
    // jsdom has no rVFC on a plain video element, so the rAF fallback names the clock.
    expect(res.clockSource).toBe("callback");
    expect(res.rafPeriodMs).toBeGreaterThan(0);
    expect(["OK", "INCONCLUSIVE", "UNRELIABLE"]).toContain(res.verdict);
  }, 20000);

  it("leaves a stopped tracker stopped", async () => {
    const { tracker, started } = loopbackTracker(0);
    const res = await runLoopback(tracker, {
      durationMs: 120,
      gapMinMs: 30,
      gapMaxMs: 40,
      seed: 3,
    });
    expect(tracker.running).toBe(false);
    expect(started).toHaveLength(0);
    expect(res.settings.durationMs).toBe(120);
  }, 20000);

  it("says INCONCLUSIVE rather than guessing when there are no edges", async () => {
    const { tracker } = loopbackTracker(0);
    const res = await runLoopback(tracker, {
      durationMs: 400,
      gapMinMs: 5000,
      gapMaxMs: 6000,
      seed: 1,
    });
    expect(res.nEdges).toBe(0);
    expect(res.verdict).toBe("INCONCLUSIVE");
    expect(res.reason).toContain("edge");
  }, 20000);

  it("honours a container and the reduced-contrast levels", async () => {
    const { tracker } = loopbackTracker(0);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let sawLevel: string | null = null;
    const check = setInterval(() => {
      const panel = container.querySelector<HTMLElement>("[data-saccade-loopback]");
      if (panel) sawLevel = panel.style.background;
    }, 10);
    await runLoopback(tracker, {
      durationMs: 120,
      gapMinMs: 30,
      gapMaxMs: 40,
      levels: ["#333", "#ccc"],
      container,
      seed: 5,
    });
    clearInterval(check);
    expect(sawLevel).not.toBeNull();
    expect(["rgb(51, 51, 51)", "rgb(204, 204, 204)", "#333", "#ccc"]).toContain(sawLevel);
    expect(container.querySelector("[data-saccade-loopback]")).toBeNull();
    container.remove();
  }, 20000);
});
