import { fetchModelBytes, presetModules, resetModules } from "../src/assets";
import { OrtEmbeddingModel, StubEmbeddingModel } from "../src/model";
import type { SaccadeProgress } from "../src/progress";
import { SaccadeTracker } from "../src/tracker";
import { fakeLandmarks } from "./helpers/fakes";

// ---------------------------------------------------------------------------- doubles

interface FakeResponseOptions {
  /** Chunk sizes the fake body hands out, in order. */
  chunks?: number[];
  /** Content-Length header value. Omit for a response that does not declare a length. */
  contentLength?: string | null;
  ok?: boolean;
  status?: number;
  statusText?: string;
  /** Serve the whole body from arrayBuffer() instead of a stream. */
  noStream?: boolean;
}

function fakeResponse(opts: FakeResponseOptions = {}): Response {
  const chunks = opts.chunks ?? [8, 8, 4];
  const bytes = chunks.map((n, i) => new Uint8Array(n).fill(i + 1));
  let next = 0;
  const headers = {
    get: (name: string) =>
      name.toLowerCase() === "content-length" ? (opts.contentLength ?? null) : null,
  };
  const whole = (): ArrayBuffer => {
    const total = chunks.reduce((a, b) => a + b, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of bytes) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out.buffer;
  };
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "OK",
    headers,
    body: opts.noStream
      ? null
      : {
          getReader: () => ({
            read: async () =>
              next < bytes.length ? { done: false, value: bytes[next++] } : { done: true },
          }),
        },
    arrayBuffer: async () => whole(),
  } as unknown as Response;
}

/** An onnxruntime-web stand-in. `failFor` makes chosen provider attempts throw. */
function fakeOrt(failFor: (ep: string, capture: boolean) => boolean = () => false) {
  const created: { arg: unknown; options: { executionProviders: string[] } }[] = [];
  const ort = {
    env: { wasm: {} as Record<string, unknown> },
    Tensor: class {
      constructor(
        public type: string,
        public data: Float32Array,
        public dims: number[],
      ) {}
    },
    InferenceSession: {
      create: async (arg: unknown, options: { executionProviders: string[] } & any) => {
        created.push({ arg, options });
        if (failFor(options.executionProviders[0], !!options.enableGraphCapture)) {
          throw new Error(`no ${options.executionProviders[0]}`);
        }
        return {
          inputNames: ["eye_image"],
          outputNames: ["embedding"],
          run: async () => ({ embedding: { data: new Float32Array(128) } }),
          release: () => undefined,
        };
      },
    },
  };
  return { ort: ort as any, created };
}

/** A @mediapipe/tasks-vision stand-in whose FaceLandmarker always finds the same face. */
function fakeVision(): any {
  const lm = fakeLandmarks();
  return {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    FaceLandmarker: {
      createFromOptions: async () => ({
        detectForVideo: () => ({ faceLandmarks: [lm] }),
        close: () => undefined,
      }),
    },
  };
}

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: () => undefined }] } as unknown as MediaStream;
}

// ---------------------------------------------------------------------------- tests

const originalFetch = global.fetch;

describe("fetchModelBytes", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("streams the body, reporting a running byte count against Content-Length", async () => {
    global.fetch = jest.fn(async () =>
      fakeResponse({ chunks: [8, 8, 4], contentLength: "20" }),
    ) as any;
    const seen: { loaded: number; total?: number }[] = [];
    const bytes = await fetchModelBytes("/m.onnx", (loaded, total) => seen.push({ loaded, total }));

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(20);
    // Contiguous and in order: chunk i is filled with i+1.
    expect(Array.from(bytes.slice(0, 2))).toEqual([1, 1]);
    expect(Array.from(bytes.slice(16, 18))).toEqual([3, 3]);
    expect(seen).toEqual([
      { loaded: 8, total: 20 },
      { loaded: 16, total: 20 },
      { loaded: 20, total: 20 },
    ]);
  });

  it("reports loaded without total when there is no Content-Length", async () => {
    global.fetch = jest.fn(async () =>
      fakeResponse({ chunks: [5, 5], contentLength: null }),
    ) as any;
    const seen: { loaded: number; total?: number }[] = [];
    await fetchModelBytes("/m.onnx", (loaded, total) => seen.push({ loaded, total }));
    expect(seen).toEqual([
      { loaded: 5, total: undefined },
      { loaded: 10, total: undefined },
    ]);
  });

  it("ignores an unusable Content-Length", async () => {
    global.fetch = jest.fn(async () =>
      fakeResponse({ chunks: [4], contentLength: "not-a-number" }),
    ) as any;
    const seen: (number | undefined)[] = [];
    await fetchModelBytes("/m.onnx", (_loaded, total) => seen.push(total));
    expect(seen).toEqual([undefined]);
  });

  it("falls back to arrayBuffer() when the response has no streaming body", async () => {
    global.fetch = jest.fn(async () =>
      fakeResponse({ chunks: [6, 6], contentLength: null, noStream: true }),
    ) as any;
    const seen: { loaded: number; total?: number }[] = [];
    const bytes = await fetchModelBytes("/m.onnx", (loaded, total) => seen.push({ loaded, total }));
    expect(bytes.byteLength).toBe(12);
    expect(seen).toEqual([{ loaded: 12, total: 12 }]);
  });

  it("throws a message naming the url and status on a bad response", async () => {
    global.fetch = jest.fn(async () =>
      fakeResponse({ ok: false, status: 404, statusText: "Not Found" }),
    ) as any;
    await expect(fetchModelBytes("/missing.onnx")).rejects.toThrow(
      "failed to fetch /missing.onnx: 404 Not Found",
    );
  });

  it("works with no callback at all", async () => {
    global.fetch = jest.fn(async () => fakeResponse({ chunks: [3] })) as any;
    await expect(fetchModelBytes("/m.onnx")).resolves.toHaveLength(3);
  });
});

describe("OrtEmbeddingModel progress", () => {
  afterEach(() => {
    resetModules();
    global.fetch = originalFetch;
  });

  it("reports ort, model bytes and session, and fetches the .onnx exactly once", async () => {
    const { ort, created } = fakeOrt();
    presetModules(ort);
    const fetchMock = jest.fn(async () =>
      fakeResponse({ chunks: [10, 10], contentLength: "20" }),
    ) as any;
    global.fetch = fetchMock;

    const seen: SaccadeProgress[] = [];
    const model = new OrtEmbeddingModel({
      assets: { modelUrl: "/models/eye_embedding.onnx" },
      onProgress: (p) => seen.push(p),
    });
    expect(await model.init()).toEqual({ ep: "webgpu" });

    expect(seen).toEqual([
      { stage: "ort" },
      { stage: "model", loaded: 0 },
      { stage: "model", loaded: 10, total: 20 },
      { stage: "model", loaded: 20, total: 20 },
      { stage: "session" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/models/eye_embedding.onnx");

    // The bytes, not the path, reach ORT.
    expect(created).toHaveLength(1);
    expect(created[0].arg).toBeInstanceOf(Uint8Array);
    expect((created[0].arg as Uint8Array).byteLength).toBe(20);
    model.dispose();
  });

  it("reuses the one download across every execution-provider attempt", async () => {
    const { ort, created } = fakeOrt((ep) => ep === "webgpu");
    presetModules(ort);
    const fetchMock = jest.fn(async () => fakeResponse({ contentLength: "20" })) as any;
    global.fetch = fetchMock;

    const model = new OrtEmbeddingModel({ assets: { modelUrl: "/m.onnx" } });
    expect(await model.init()).toEqual({ ep: "wasm" });

    // webgpu+capture, webgpu, wasm — one fetch, three sessions, all from the same buffer.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(3);
    expect(created.every((c) => c.arg === created[0].arg)).toBe(true);
    model.dispose();
  });

  it("initialises unchanged with no progress callback, and survives a throwing one", async () => {
    const { ort } = fakeOrt();
    presetModules(ort);
    global.fetch = jest.fn(async () => fakeResponse({ contentLength: "20" })) as any;

    const quiet = new OrtEmbeddingModel({ assets: { modelUrl: "/m.onnx" } });
    expect(await quiet.init()).toEqual({ ep: "webgpu" });
    expect((await quiet.embed(new Uint8Array(36 * 144))).length).toBe(128);
    quiet.dispose();

    resetModules();
    presetModules(fakeOrt().ort);
    const noisy = new OrtEmbeddingModel({
      assets: { modelUrl: "/m.onnx" },
      onProgress: () => {
        throw new Error("listener blew up");
      },
    });
    expect(await noisy.init()).toEqual({ ep: "webgpu" });
    noisy.dispose();
  });
});

describe("SaccadeTracker progress", () => {
  afterEach(() => resetModules());

  it("walks camera, mediapipe, landmarker and ready in order", async () => {
    presetModules(undefined, fakeVision());
    const seen: SaccadeProgress[] = [];
    const getUserMedia = jest.fn(async () => fakeStream());
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    // A supplied model owns its own loading, so the ort/model/session stages are its business;
    // what this checks is the tracker's own stage sequence around it.
    const t = new SaccadeTracker({
      model: new StubEmbeddingModel(),
      onProgress: (p) => seen.push(p),
    });
    t.video.play = async () => undefined;
    Object.defineProperty(t.video, "videoWidth", { value: 64, configurable: true });
    Object.defineProperty(t.video, "videoHeight", { value: 48, configurable: true });

    await t.init();
    expect(seen.map((p) => p.stage)).toEqual(["camera", "mediapipe", "landmarker", "ready"]);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    t.dispose();
  }, 15000);

  it("skips the camera stage when a stream is supplied", async () => {
    presetModules(undefined, fakeVision());
    const seen: SaccadeProgress[] = [];
    const t = new SaccadeTracker({
      stream: fakeStream(),
      model: new StubEmbeddingModel(),
      onProgress: (p) => seen.push(p),
    });
    t.video.play = async () => undefined;
    Object.defineProperty(t.video, "videoWidth", { value: 64, configurable: true });
    Object.defineProperty(t.video, "videoHeight", { value: 48, configurable: true });

    await t.init();
    expect(seen.map((p) => p.stage)).toEqual(["mediapipe", "landmarker", "ready"]);
    t.dispose();
  }, 15000);
});
