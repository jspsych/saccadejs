const base = require("@jspsych/config/jest").makePackageConfig(__dirname);

// `src/importMeta.ts` is the one file containing `import.meta`, which is a syntax error in the
// CommonJS modules jest runs. Swap it for a stub that answers the way the real one does when
// the build is not being served from a `@saccadejs/core/dist/`.
module.exports = {
  ...base,
  moduleNameMapper: {
    ...base.moduleNameMapper,
    "^(?:\\.\\.?/)+importMeta$": "<rootDir>/test/stubs/importMeta.ts",
  },
};
