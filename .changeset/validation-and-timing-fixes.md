---
"@saccadejs/core": minor
"@saccadejs/plugin-validate": minor
"@saccadejs/plugin-time-sync": minor
---

- `median_error_viewport` is now the error as a fraction of the viewport's diagonal, instead of x/width and y/height combined. The same pixel error no longer counts for more in the viewport's shorter direction, and on a 16:9 viewport the value is in the unit the model's held-out error is reported in.
- `lambdaFor` is now given the number of distinct calibration targets rather than rows, so nine dots shown twice still get the nine-point penalty. `fitCalibration()`'s `nPoints` counts distinct targets too, and the new `countTargets()` helper does the counting.
- The time-sync trial applies the measured lag only when the verdict is `OK`. Any other verdict is recorded with `applied: false`.
- Corrected the time-sync flash-rate wording: at most two changes, or one flash, per second.
