const base = require("@jspsych/config/jest").makePackageConfig(__dirname);

// `src/importMeta.ts` is the one file containing `import.meta`, which is a syntax error in the
// CommonJS modules jest runs. Swap it for a stub that answers the way the real one does when
// the build is not being served from a `@saccadejs/core/dist/`.
module.exports = {
  ...base,
  // jsdom has no WebGL, and the landmarker refuses to start without it. Tests stand in for a
  // browser that has it; the ones about a browser without it take the stub away.
  setupFiles: [...(base.setupFiles ?? []), "<rootDir>/test/stubs/webgl.ts"],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    "^(?:\\.\\.?/)+importMeta$": "<rootDir>/test/stubs/importMeta.ts",
  },
};
