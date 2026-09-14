---
"@saccadejs/core": patch
---

Added `models/releases.json`, a registry describing every published version of the
eye-embedding model: its version, sha256, size, preprocessing contract, ONNX I/O, and the
W&B checkpoint it came from.

The registry ships with the package and is importable as
`@saccadejs/core/models/releases.json`, so a consumer can check which model version their
installed core expects without trusting a filename. (The `exports` map now also lists
`./package.json`, which tooling commonly asks for.) It is also what the docs site builds its
`/models` page from, and what lets the site serve each release from a versioned URL —
`/models/eye-embedding/1.0.0/eye_embedding.onnx`. Versioned URLs are the only ones the site
serves: an unversioned "latest" path would change under a running study without saying so.

Model version is independent of the package version: patch/minor means new weights behind an
identical interface, major means the preprocessing contract changed.
