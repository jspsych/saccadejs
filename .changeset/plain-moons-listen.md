---
"@saccadejs/core": minor
"@saccadejs/extension": minor
"@saccadejs/plugin-calibrate": minor
---

The embedding width is no longer fixed at 128, and calibration row weighting now comes from the
model rather than from the library.

**Any consistent embedding width.** The ridge solve and both mean-embedding paths read their
width from the embeddings they are handed instead of from a compile-time constant, so a model
of any output length works, provided that length is the same on every frame of a session.
`EMB_DIM` stays exported as the shipped model's width, for reference rather than as a
requirement. The crop
side is unchanged and still exact: 36x144 gray, built by the preprocessing in `crop.ts`.

**Calibration weights now come from the model.** A model may carry a per-frame quality score
as a second graph output — `cal_weight`, sigmoid, in [0, 1]. The tracker weights the frames
making up a calibration point's mean embedding by it, then averages it into that point's row
weight in the fit. eye-embedding 1.0.0 now includes one.

This removes a way for the weighting and the embedding to disagree. The model is fetched by
URL at runtime, while the previous weights file was compiled into whichever `@saccadejs/core`
a study installed, and the two version numbers move independently — so a study could pin one
model version and score it with a different one's head. The sha256 that identifies the model
now covers the head as well.

`CAL_HEAD` is no longer applied automatically. It remains exported, and
`SaccadeTrackerOptions.calHead` opts back into it; the default is the model's own weights, or
none. `fitCalibration()` returns `weighting: "model" | "head" | "uniform"` saying which ran,
`saccade-calibrate` records it as a `weighting` column, and `EmbeddingModel.embed()` resolves
to `{ embedding, weight }`, which keeps the weight paired with the embedding it describes.

**Five silent failures now throw.** A `CalHead` whose length did not match the embedding read
past the end of its kernel and turned every coefficient of the fit into NaN, with no error
anywhere; it throws now. So do an embedding whose width changes mid-session, a ragged set of
calibration rows, a half-weighted calibration set (defaulting the unweighted points to 1 made
them the highest-weighted rows in the fit), and a weight output that is not a finite number in
[0, 1]. The last throws at `init()`, on the warm-up inference, before any participant data
exists.
