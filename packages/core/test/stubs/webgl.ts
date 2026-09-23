// A browser with WebGL, for jsdom, which has none. Only the WebGL kinds are faked; "2d" and
// everything else still goes to jsdom's own getContext.
const original = HTMLCanvasElement.prototype.getContext;

HTMLCanvasElement.prototype.getContext = function (
  this: HTMLCanvasElement,
  kind: string,
  ...rest: unknown[]
) {
  if (kind === "webgl2" || kind === "webgl") return { getExtension: () => null } as never;
  return (original as (...a: unknown[]) => unknown).call(this, kind, ...rest) as never;
} as typeof HTMLCanvasElement.prototype.getContext;

export const originalGetContext = original;
