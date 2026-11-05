---
"@saccadejs/core": patch
---

The face landmarker now loads from Google's versioned address (`float16/1/face_landmarker.task`) instead of `float16/latest/`, so a new release from Google cannot change the face finder partway through a study. The two addresses currently serve the same file.
