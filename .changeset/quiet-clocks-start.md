---
"@saccadejs/extension": minor
---

`saccade_timing.trial_start` records the `performance.now()` value that `saccade_data`'s `t` is
measured from.

Subtract it from a timestamp you take yourself — a mid-trial sound, a second display change, a
moving target's positions — to put that event on the same axis as the gaze. Record the event in
the trial's own data; the extension has no event API.
