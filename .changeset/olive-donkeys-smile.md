---
"@saccadejs/core": minor
"@saccadejs/extension": minor
---

Renamed `tta` to `smoothing_frames` (`smoothingFrames` in the core), and changed its default from
5 to 1.

`tta` stood for test-time augmentation, which described the technique rather than the setting: the
number is how many consecutive camera frames are averaged into one gaze estimate. It is now
`SaccadeTrackerOptions.smoothingFrames` with `setSmoothingFrames` / `getSmoothingFrames`, the
extension's `smoothing_frames` initialize parameter, and `saccade_timing.smoothing_frames` in the
trial data.

The default of 5 bought a steadier estimate at the cost of ~67 ms of lag at 30 fps, and it was
paid silently by every experiment, including gaze-contingent ones that could least afford it. The
default is now 1: predict from the newest frame, and let a study that wants smoothing ask for it.

`saccade_timing.smoothing_frames` now reports what the tracker was actually smoothing over rather
than the extension's parameter, so it stays true when you supply your own `tracker` or call
`setSmoothingFrames` mid-experiment.
