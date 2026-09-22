---
"@saccadejs/core": minor
"@saccadejs/extension": patch
---

Fixed the setup progress bar never moving when the page builds its own tracker and hands it to
the extension through the `tracker` parameter. The extension only heard progress from a tracker
it had built, so `saccade-preview` sat at "Starting…" until init finished. On a first visit
that is a download of about 60 MB, which looked like a hang.

`SaccadeTracker` now has `onProgress(cb)`, a subscription to `init()`'s load progress that
works like `onFrame(cb)`. It delivers the most recent report straight away and returns the
unsubscribe function. The extension subscribes through it whichever way it got its tracker.
