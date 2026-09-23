---
"@saccadejs/core": minor
---

Opt-in head pose from the landmarker. `createLandmarker({ headPose: true })` turns on MediaPipe's facial transformation matrices, and the new `detectFace()` returns the landmarks together with the 4x4 head-pose matrix (column-major; the row or column order MediaPipe used is detected from the matrix). `headPoseFromMatrix()` converts the matrix to yaw, pitch and roll in degrees, plus position. `detect()` is unchanged, and the tracker's own pipeline does not turn head pose on.
