---
"@saccadejs/core": minor
"@saccadejs/plugin-time-sync": patch
---

The time-sync verdict now requires a peak edge statistic (`peakD` / `peak_d`) of at least 0.6, up from 0.5. In bench tests against a photodiode, a 15 s run in bright light at 15 fps, where the screen barely changed the camera image, passed as `"OK"` at D = 0.52 with a delay off by more than 400 ms. No correct run in those tests fell between 0.5 and 0.6.
