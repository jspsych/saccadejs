const config = require("@jspsych/config/jest").makePackageConfig(__dirname);

// The real core needs a camera, WebGPU and a 3 MB ONNX model; tests run against a local stub.
config.moduleNameMapper = {
  ...config.moduleNameMapper,
  "^saccadejs$": "<rootDir>/src/test-stubs/saccadejs.ts",
};

module.exports = config;
