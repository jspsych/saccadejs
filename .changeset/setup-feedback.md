---
"@saccadejs/core": minor
"@saccadejs/plugin-preview": minor
---

The preview now tells participants whether they are close enough to the camera and whether their eyes are lit well enough. In the validation study, participants who sat farther away (a smaller distance between the eyes in the image) or whose eye images had less contrast were tracked less accurately. Each measure is averaged over about a third of a second and compared with a threshold near the 10th percentile of the training participants; the advice never disables the continue button. New parameters `show_setup_feedback`, `min_interocular_distance`, `max_interocular_distance` and `min_eye_contrast`; new data fields `interocular_distance`, `eye_contrast`, `eye_brightness`, `distance_feedback` and `lighting_feedback`.

In core, every `TrackerFrame` has a `quality` field (`FrameQuality`: `interocularDistance`, `eyeBrightness`, `eyeContrast`), `EyeCrop` gains `brightness` and `contrast` of the raw crop, and `interocularDistance(landmarks)` is exported.
