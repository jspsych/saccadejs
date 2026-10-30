/**
 * A stand-in for `@saccadejs/extension` for use in this package's tests.
 *
 * It registers under the same extension name (`"saccade"`), so the plugin under test picks it up
 * from `jsPsych.extensions.saccade` exactly as it would the real thing. Set `mode` and
 * `catchUpResult` before starting the timeline; `release()` resolves a pending `catchUp`.
 */
import { JsPsych, JsPsychExtension, JsPsychExtensionInfo } from "jspsych";

export class StubSaccadeExtension implements JsPsychExtension {
  static info: JsPsychExtensionInfo = {
    name: "saccade",
    version: "0.0.0",
    data: {},
  };

  mode: "live" | "deferred" = "deferred";
  readonly tracker = { running: true, deferred: { throughput: 4 as number | null } };
  catchUpResult = {
    mode: "deferred" as "live" | "deferred",
    frames_waiting: 40,
    frames_lost: 0,
    timed_out: false,
    crops_saved: 0,
    wait_ms: 1234,
  };
  /** The options the last `catchUp` was called with. */
  catchUpOptions: any = null;
  private resolveCatchUp: (() => void) | null = null;

  constructor(private jsPsych: JsPsych) {}

  initialize = async () => {};
  on_start = () => {};
  on_load = () => {};
  on_finish = () => ({});

  isInitialized = () => true;
  getTracker = () => this.tracker as any;
  getMode = () => this.mode;
  pause = jest.fn(() => {
    this.tracker.running = false;
  });
  resume = jest.fn(() => {
    this.tracker.running = true;
  });

  catchUp = jest.fn((opts: any) => {
    this.catchUpOptions = opts;
    return new Promise<typeof this.catchUpResult>((resolve) => {
      this.resolveCatchUp = () => resolve({ ...this.catchUpResult, mode: this.mode });
      if (this.mode === "live") this.resolveCatchUp();
    });
  });

  /** Test helper: let the pending `catchUp` finish. */
  release() {
    this.resolveCatchUp?.();
  }
}
