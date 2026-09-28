import { presetModules, resetModules } from "../src/assets";
import {
  WebGLUnavailableError,
  createLandmarker,
  headPoseFromMatrix,
  webglAvailable,
} from "../src/landmarker";
import { fakeLandmarks } from "./helpers/fakes";

const RAD = Math.PI / 180;

/** R = Ry(yaw) Rx(pitch) Rz(roll), as a row-major 3x3. */
function rotation(yawDeg: number, pitchDeg: number, rollDeg: number): number[][] {
  const [y, p, r] = [yawDeg * RAD, pitchDeg * RAD, rollDeg * RAD];
  const Ry = [
    [Math.cos(y), 0, Math.sin(y)],
    [0, 1, 0],
    [-Math.sin(y), 0, Math.cos(y)],
  ];
  const Rx = [
    [1, 0, 0],
    [0, Math.cos(p), -Math.sin(p)],
    [0, Math.sin(p), Math.cos(p)],
  ];
  const Rz = [
    [Math.cos(r), -Math.sin(r), 0],
    [Math.sin(r), Math.cos(r), 0],
    [0, 0, 1],
  ];
  const mul = (a: number[][], b: number[][]) =>
    a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
  return mul(Ry, mul(Rx, Rz));
}

/** A rigid 4x4 transform, flattened in the given order. */
function transform(R: number[][], t: number[], order: "column" | "row"): number[] {
  const M = [
    [...R[0], t[0]],
    [...R[1], t[1]],
    [...R[2], t[2]],
    [0, 0, 0, 1],
  ];
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) out.push(order === "row" ? M[i][j] : M[j][i]);
  }
  return out;
}

/** A tasks-vision stand-in that records the options and returns one face, with a matrix. */
function fakeVision(matrixData: number[] | null) {
  const seen: any[] = [];
  const vision = {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    FaceLandmarker: {
      createFromOptions: async (_fileset: unknown, options: any) => {
        seen.push(options);
        return {
          detectForVideo: () => ({
            faceLandmarks: [fakeLandmarks()],
            facialTransformationMatrixes: matrixData
              ? [{ rows: 4, columns: 4, data: matrixData }]
              : [],
          }),
          close: () => undefined,
        };
      },
    },
  };
  return { vision, seen };
}

const video = {} as HTMLVideoElement;

describe("headPoseFromMatrix", () => {
  it("recovers yaw, pitch and roll from a known rotation", () => {
    for (const [yaw, pitch, roll] of [
      [0, 0, 0],
      [20, 0, 0],
      [0, -15, 0],
      [0, 0, 10],
      [25, -12, 8],
      [-30, 20, -5],
    ]) {
      const pose = headPoseFromMatrix(
        transform(rotation(yaw, pitch, roll), [1, -2, -50], "column"),
      );
      expect(pose.yaw).toBeCloseTo(yaw, 6);
      expect(pose.pitch).toBeCloseTo(pitch, 6);
      expect(pose.roll).toBeCloseTo(roll, 6);
      expect([pose.x, pose.y, pose.z]).toEqual([1, -2, -50]);
    }
  });
});

describe("Landmarker head pose", () => {
  afterEach(() => resetModules());

  it("leaves MediaPipe's transformation matrices off by default", async () => {
    const { vision, seen } = fakeVision(transform(rotation(10, 0, 0), [0, 0, -50], "column"));
    presetModules(undefined, vision);
    const lm = await createLandmarker();

    expect(seen[0].outputFacialTransformationMatrixes).toBe(false);
    const face = lm.detectFace(video, 1);
    expect(face!.landmarks).toHaveLength(fakeLandmarks().length);
    expect(face!.pose).toBeNull();
    // detect() is unchanged: landmarks only
    expect(lm.detect(video, 2)).toHaveLength(fakeLandmarks().length);
  });

  it("returns the pose, column-major, whichever order MediaPipe flattened it in", async () => {
    const R = rotation(18, -7, 4);
    for (const order of ["column", "row"] as const) {
      const { vision, seen } = fakeVision(transform(R, [3, 1, -48], order));
      presetModules(undefined, vision);
      const lm = await createLandmarker({ headPose: true });

      expect(seen[0].outputFacialTransformationMatrixes).toBe(true);
      const pose = lm.detectFace(video, 1)!.pose!;
      expect(Array.from(pose.slice(12, 15))).toEqual([3, 1, -48]);
      const angles = headPoseFromMatrix(pose);
      expect(angles.yaw).toBeCloseTo(18, 4);
      expect(angles.pitch).toBeCloseTo(-7, 4);
      expect(angles.roll).toBeCloseTo(4, 4);
      resetModules();
    }
  });

  it("gives a null pose rather than failing when MediaPipe returns no matrix", async () => {
    const { vision } = fakeVision(null);
    presetModules(undefined, vision);
    const lm = await createLandmarker({ headPose: true });
    expect(lm.detectFace(video, 1)!.pose).toBeNull();
  });
});

describe("Landmarker without WebGL", () => {
  const withoutWebGL = async (fn: () => Promise<void>) => {
    const stubbed = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
      return kind === "webgl2" || kind === "webgl" ? null : stubbed.call(this, kind as "2d");
    } as typeof stubbed;
    try {
      await fn();
    } finally {
      HTMLCanvasElement.prototype.getContext = stubbed;
      resetModules();
    }
  };

  it("reports WebGL when the browser has it", () => {
    expect(webglAvailable()).toBe(true);
  });

  it("refuses to start, before loading MediaPipe, when there is no WebGL", async () => {
    await withoutWebGL(async () => {
      expect(webglAvailable()).toBe(false);
      const { vision, seen } = fakeVision(null);
      presetModules(undefined, vision);

      const attempt = createLandmarker();
      await expect(attempt).rejects.toBeInstanceOf(WebGLUnavailableError);
      await expect(attempt).rejects.toThrow(/needs WebGL/);
      // failed up front: the face landmarker was never built
      expect(seen).toHaveLength(0);
    });
  });
});
