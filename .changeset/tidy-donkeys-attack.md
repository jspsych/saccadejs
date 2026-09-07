---
"@saccadejs/plugin-performance": minor
---

New plugin: `saccade-performance`. Measures the tracker's effective frame rate on the
participant's machine — `fps_median`, `fps_p10`, dropped camera frames, median inference time and
the execution provider — and can end the experiment for machines too slow for the study.

Exclusion follows `browser-check`: an `inclusion_function` over the measured data and an
`exclusion_message` built from the same data. The default includes everyone, so the trial is a
pure measurement until you give it a threshold.

Frames with no face in them are kept out of the rates: they never reach the model, so counting
them would report a rate the machine cannot sustain while it is actually tracking.
