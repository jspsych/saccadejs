---
"@saccadejs/extension": patch
---

Fixed `getCurrentPrediction()` and `onGazeUpdate` reporting a different `t` depending on whether
the current trial had the extension attached.

Their `t` is now always absolute: `(time.meanCapture ?? time.capture)` minus the timing offset,
on the `performance.now()` scale. `saccade_data` is unchanged, and its `t` is still measured from
the start of the trial.

Previously, while a trial with the extension attached was running, the live `t` was measured from
that trial's start instead, and from zero everywhere else. `saccade-validate` subtracts a start
time it stamps itself, so attaching the extension to a validation trial filled `raw_gaze` with
large negative `t` values.

**Behavior change:** if you read `t` from `onGazeUpdate` or `getCurrentPrediction()` inside a
trial that records with the extension and relied on it being trial-relative, subtract your own
start time (`performance.now()` at the trial's load) instead.
