---
"@saccadejs/core": patch
---

eye-embedding 1.0.0 now exports two outputs: the `embedding`, and `cal_weight`, the trained
per-frame calibration weight that previously shipped beside the model as JSON.

The embedding is bit-identical to the earlier pre-release export, verified across the whole
parity fixture set, so gaze from this model is unchanged. The calibration weighting is now part
of the bytes the model's sha256 identifies, rather than a file compiled into a package whose
version moves independently of the model's.

The head is not retrained. It was always `Dense(1, sigmoid)` over one image's embedding; the
export re-uses that trained layer on a single crop rather than a `(batch, targets, dim)` stack.
This also corrects a training/inference mismatch, since the library used to apply that
per-image head to a mean over a whole capture window — something training never did.
