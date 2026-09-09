---
"@saccadejs/core": patch
---

Every published model version now stays served, not just the newest.

`copy-model.mjs` staged only the most recent release, so the moment a second version existed
the first one's URL would have 404ed — a versioned URL that stops resolving is worse than one
never published, because by then it is in someone's methods section. It now stages every
release marked `served`, verifies each one's sha256, and **fails the build** if a served
version has lost its file.

Model files are ~20 MB and sit on the same infrastructure as the docs site, so the policy is
to keep every version up indefinitely; `served: false` is for a deliberate withdrawal, not
housekeeping. Superseded versions live at `models/<version>/eye_embedding.onnx` while the
current one stays at `models/eye_embedding.onnx`, where `assets.ts` resolves it for bundler
users; each release's `file` field names where its bytes are.
