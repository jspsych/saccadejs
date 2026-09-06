/**
 * jest runs the sources as CommonJS, where `import.meta` is a syntax error, so
 * `src/importMeta.ts` is mapped to this stub (see jest.config.cjs). Returning null is the
 * same answer the real module gives whenever the build is not being served from a
 * `saccadejs/dist/`, which is what the tests exercise.
 */
export function moduleUrl(): string | null {
  return null;
}
