---
id: how-it-works
title: How it works
sidebar_label: How it works
description: Landmarks, crop, embedding, ridge regression — the pipeline from a camera frame to a point on the screen.
---

# How it works

Four stages turn a camera frame into a point on the screen. Three of them are the same for
everybody; only the last one is fitted per participant, which is why calibration is short.

```
camera frame ──▶ face landmarks ──▶ 144×36 eye crop ──▶ 128-d embedding ──▶ ridge ──▶ (x, y)
   captureTime      MediaPipe         gray+CLAHE          ONNX / WebGPU      per person
```

## 1 · Landmarks

Each frame arrives through `requestVideoFrameCallback`, which hands over both the frame and its
metadata — crucially `captureTime`, discussed in
[Timing and synchrony](timing-and-synchrony). MediaPipe's **Face Landmarker** runs in VIDEO
mode with `numFaces: 1`, using the GPU delegate and falling back to CPU, and returns 478 3-D
landmarks. Only the eye landmarks are used, and only to decide where to cut.

If no face is found the frame produces no gaze estimate at all, rather than a stale or
extrapolated one. Gaps in `saccade_data` are therefore informative.

## 2 · The crop

This is the stage that most determines whether the model works, and it is the stage most
easily got subtly wrong.

From the eye landmarks the frame is cut to a single strip spanning **both eyes**, resized to
**144 × 36** pixels, converted to grayscale, and contrast-equalised with **CLAHE** — adaptive
histogram equalisation with a **clip limit of 2.0 over an 8 × 8 tile grid**. (Those are the
settings handed to OpenCV. What OpenCV does with them on a 144 × 36 image is pad the height to
40 and work in 18 × 5 pixel tiles, at which size the clip limit rounds down to an effective 1 —
worth knowing only if you are reimplementing the step and comparing byte for byte.) The result
is the model's entire input: 5184 bytes per frame. Everything else — the rest of the face, the
room, colour — is discarded.

Two constraints follow from having a trained model at the other end:

- **The preprocessing must be bit-exact with what the model was trained on.** The training
  pipeline used OpenCV's grayscale conversion, `INTER_LINEAR` resize and `createCLAHE`, and the
  browser port reproduces each of them to the byte, verified against fixtures generated from
  OpenCV itself. A resize that is off by a rounding rule is not a small error; it is a
  distribution shift the model was never trained under.
- **The cropped frame is never mirrored.** The camera preview is flipped horizontally with CSS
  because a mirrored preview is what people can position themselves with, but the pixels that
  reach the model are the unmirrored ones. Feeding a mirrored crop to a model trained on
  unmirrored eyes reliably produces a left–right inverted gaze estimate, which looks just
  plausible enough to go unnoticed.

CLAHE is what makes the pipeline tolerant of ordinary room lighting: it normalises local
contrast, so a dim room and a bright one produce comparable inputs. It does not rescue
backlighting, where the eyes are in shadow and there is no local contrast to equalise.

## 3 · The embedding

The crop goes through a small convolutional network exported to **ONNX** (opset 17), run by
onnxruntime-web on **WebGPU** where available and on the WebAssembly backend otherwise. Input
`eye_image`, float32 `[1, 36, 144, 1]`, values 0–255. Output `embedding`, float32 `[1, 128]`.

The model is **frozen and participant-independent**. It was trained on a large webcam gaze
dataset to produce a representation in which the direction someone is looking is close to
linear — that is the whole trick, and it is what separates this from geometric approaches. It
is not asked to predict screen coordinates, because screen coordinates depend on where the
screen is and how big it is; it is asked to represent eye appearance well enough that a linear
model can finish the job.

Two implementation details matter for throughput:

- **The pipeline is overlapped.** While the GPU computes the embedding for frame *N*, the CPU
  is already grabbing and cropping frame *N+1*. Exactly one `session.run` is ever in flight,
  which keeps the runtime's own queue from becoming a source of latency.
- **Test-time augmentation is a ring buffer.** The last `tta` embeddings (default 5) are
  averaged before prediction. This is a meaningful noise reduction — single-frame estimates are
  jumpy — but it means the estimate refers to the *mean* of those frames' capture times, which
  is why `FrameTime.meanCapture` exists and why gaze-contingent designs should set `tta: 1`.

## 4 · The ridge

The mapping from a 128-dimensional embedding to a point on the screen is a **ridge regression**,
fitted per participant during calibration:

```
x  =  wₓ · (e − c)        y  =  w_y · (e − c)
```

where `e` is the averaged embedding, `c` a fixed centering constant that ships with the model,
and `wₓ`, `w_y` the fitted weights. Fitting 128 coefficients from 13 observations is
underdetermined, which is exactly why the ridge penalty is not optional: λ is what keeps the
solution from chasing noise in a handful of points. `lambdaFor(n)` returns **3** for nine points
or fewer and **1** above that — fewer points, more regularisation.

Calibration itself is deliberately dull. For each target: show a ring that shrinks for a settle
interval (1000 ms) while the eyes get there, then turn it green and collect every embedding for
a capture interval (500 ms). Average them into one observation per point. Thirteen points at
1.5 s each is about twenty seconds of a participant's time.

### The grids

| Grid | Points | Where |
| --- | --- | --- |
| `defaultGrid13()` | 13 | 3 × 3 at 5/50/95% of each axis, plus 4 at 27.5/72.5% — corners for range, inner points for curvature |
| `trainingGrid20()` | 20 | 4 × 5, denser, for when you can afford ~30 s |
| `validationGrid9()` | 9 | 3 × 3 at 15/50/85%, **deliberately not on the calibration grid** |

The validation grid is inset and offset from the calibration grid on purpose. Validating on the
points you fitted measures the fit, not the participant, and will flatter you by a wide margin.
The nine held-out points are the number to report.

## What limits the accuracy

In rough order of how much they matter in practice:

1. **Head movement after calibration.** The ridge maps eye appearance to screen position for
   the head pose that was there during calibration. A participant who leans in has changed the
   problem. A chin rest is not available to you; asking people to sit still is.
2. **Lighting on the face.** Front light is good, side light is workable, backlight is not.
   CLAHE does a lot but cannot invent contrast that was never captured.
3. **Screen size and viewing distance.** A large screen at close range subtends a large visual
   angle, so the same angular error covers fewer pixels — big screens are easier in pixel terms
   and harder in the corners, where the eye rotation is extreme and calibration coverage is
   thinnest.
4. **Glasses.** Reflections can occlude the eye region entirely for a range of head angles.
5. **Camera quality and frame rate.** A 30 fps camera bounds your temporal resolution at 33 ms
   regardless of everything else.

Expect a median held-out error in the region of **a tenth of the viewport**. That is enough to
separate two halves of a screen, four quadrants, or a handful of well-spaced regions of
interest. It is not enough for reading, for small stimuli, or for anything requiring
sub-degree precision. Measure it with [`saccade-validate`](../reference/plugin-validate) on
every participant and report the distribution.
