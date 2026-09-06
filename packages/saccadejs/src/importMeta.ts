/**
 * Where this build is being served from, used only to find `models/eye_embedding.onnx` next to
 * it. Two mechanisms, because no single one survives every output format:
 *
 *  - `import.meta.url` works in the ESM build, and rollup shims it for the cjs output. It is
 *    the one syntax form that only exists in modules, so it is confined to this file: under
 *    jest (CommonJS) the file is swapped for a stub, and esbuild's es2015 target — which the
 *    minified browser build uses — erases it to `{}`.
 *  - `document.currentScript`, captured while this module is first evaluated (which for the
 *    iife build is exactly when the `<script>` tag runs), covers that minified build.
 */
const scriptUrl: string | null =
  typeof document !== "undefined" && document.currentScript
    ? (document.currentScript as HTMLScriptElement).src || null
    : null;

export function moduleUrl(): string | null {
  try {
    const url: string | undefined = import.meta.url;
    if (typeof url === "string" && url.length > 0) return url;
  } catch {
    /* not an ES module: fall through */
  }
  return scriptUrl;
}
