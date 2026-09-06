import { StubEmbeddingModel } from "../src/model";
import type { TrackerFrame } from "../src/pipeline";
import { Pipeline } from "../src/pipeline";
import { fakeLandmarker, fakeVideo, waitFor } from "./helpers/fakes";

describe("Pipeline", () => {
  it("emits a frame per camera frame, stamped from rVFC captureTime", async () => {
    const video = fakeVideo();
    const p = new Pipeline(video.el, fakeLandmarker(), new StubEmbeddingModel(), { tta: 5 });
    const frames: TrackerFrame[] = [];
    p.onFrame = (f) => frames.push(f);
    p.start();
    await waitFor(() => frames.length >= 6);
    p.stop();
    video.stop();

    const f = frames[3];
    expect(f.faceFound).toBe(true);
    expect(f.time.source).toBe("captureTime");
    expect(f.time.capture).toBe(f.time.callback - 20);
    expect(f.time.receive).toBe(f.time.callback - 5);
    expect(f.time.dropped).toBe(0);
    expect(f.time.emit).toBeGreaterThan(0);
    expect(f.embedding).not.toBeNull();
    expect(f.embedding!.length).toBe(128);
    expect(f.crop!.length).toBe(36 * 144);
    // No calibration yet, so there is nothing to map the embedding through.
    expect(f.gaze).toBeNull();
  });

  it("averages the ring buffer and reports the mean capture time it refers to", async () => {
    const video = fakeVideo();
    const p = new Pipeline(video.el, fakeLandmarker(), new StubEmbeddingModel(), { tta: 3 });
    const frames: TrackerFrame[] = [];
    p.onFrame = (f) => frames.push(f);
    p.start();
    await waitFor(() => frames.filter((f) => f.embedding).length >= 5);
    p.stop();
    video.stop();

    const withEmb = frames.filter((f) => f.embedding);
    const last = withEmb[withEmb.length - 1];
    const window = withEmb.slice(-3);
    const expectedMeanCapture = window.reduce((a, f) => a + f.time.capture, 0) / window.length;
    expect(last.time.meanCapture).toBeCloseTo(expectedMeanCapture, 6);
    // The mean embedding is the mean of the ring, element by element.
    const expected0 = window.reduce((a, f) => a + f.embedding![0], 0) / window.length;
    expect(last.meanEmbedding![0]).toBeCloseTo(expected0, 5);
  });

  it("produces gaze once a kernel is set, and reports no face when none is found", async () => {
    const video = fakeVideo();
    const p = new Pipeline(video.el, fakeLandmarker(), new StubEmbeddingModel(), { tta: 1 });
    // A kernel that ignores the embedding puts every prediction at the centre.
    p.setKernel(new Float32Array(256));
    expect(p.hasKernel()).toBe(true);
    const frames: TrackerFrame[] = [];
    p.onFrame = (f) => frames.push(f);
    p.start();
    await waitFor(() => frames.some((f) => f.gaze));
    p.stop();
    video.stop();
    const g = frames.find((f) => f.gaze)!.gaze!;
    expect(g.x).toBeCloseTo(0.5, 6);
    expect(g.y).toBeCloseTo(0.5, 6);

    const video2 = fakeVideo();
    const p2 = new Pipeline(video2.el, fakeLandmarker(false), new StubEmbeddingModel(), {});
    const noFace: TrackerFrame[] = [];
    p2.onFrame = (f) => noFace.push(f);
    p2.start();
    await waitFor(() => noFace.length >= 2);
    p2.stop();
    video2.stop();
    expect(noFace[0].faceFound).toBe(false);
    expect(noFace[0].embedding).toBeNull();
    expect(noFace[0].crop).toBeNull();
  });

  it("falls back to requestAnimationFrame when rVFC is unavailable", async () => {
    const video = fakeVideo({ rvfc: false });
    const p = new Pipeline(video.el, fakeLandmarker(), new StubEmbeddingModel(), {});
    const frames: TrackerFrame[] = [];
    p.onFrame = (f) => frames.push(f);
    p.start();
    await waitFor(() => frames.length >= 2);
    p.stop();
    expect(frames[0].time.source).toBe("callback");
    expect(frames[0].time.presentedFrames).toBeNull();
  });

  it("resolves nextFrame / nextEmbedding with the next emitted frame", async () => {
    const video = fakeVideo();
    const p = new Pipeline(video.el, fakeLandmarker(), new StubEmbeddingModel(), { tta: 1 });
    p.start();
    const frame = await p.nextFrame();
    expect(frame.time.capture).toBeGreaterThan(0);
    const e = await p.nextEmbedding();
    expect(e).not.toBeNull();
    p.stop();
    video.stop();
  });

  it("stops scheduling after stop()", async () => {
    const video = fakeVideo();
    const p = new Pipeline(video.el, fakeLandmarker(), new StubEmbeddingModel(), {});
    let n = 0;
    p.onFrame = () => n++;
    p.start();
    await waitFor(() => n >= 2);
    p.stop();
    expect(p.running).toBe(false);
    const at = n;
    await new Promise((r) => setTimeout(r, 50));
    video.stop();
    // At most the frame already in flight when stop() was called may still land.
    expect(n - at).toBeLessThanOrEqual(1);
  });
});
