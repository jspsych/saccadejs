const config = require("@jspsych/config/jest").makePackageConfig(__dirname);

// `runLoopback` flashes the real screen and reads the real webcam; tests run against a local stub.
config.moduleNameMapper = {
  ...config.moduleNameMapper,
  "^@saccadejs/core$": "<rootDir>/src/test-stubs/saccadejs.ts",
};

module.exports = config;
