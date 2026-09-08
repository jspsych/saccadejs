---
"@saccadejs/core": patch
---

Added `models/releases.json`, a registry describing every published version of the
eye-embedding model: its version, sha256, size, preprocessing contract, ONNX I/O, and the
W&B checkpoint it came from.

The registry ships with the package, so a consumer can check which model they have without
trusting a filename. It is also what the docs site builds its `/models` page from, and what
lets the site serve a versioned URL — `/models/eye-embedding/1.0.0/eye_embedding.onnx` —
alongside the mutable `/models/eye_embedding.onnx` that studies should not point at.

Model version is independent of the package version: patch/minor means new weights behind an
identical interface, major means the preprocessing contract changed.
