---
id: how-it-works
title: How it works
sidebar_label: How it works
description: The pipeline from a camera frame to a point on the screen, in one page.
---

# How it works

You do not need any of this to use saccade.js. It is here for when you want to describe the
method in a paper, or work out why something is behaving the way it is.

## From a camera frame to a point on the screen

1. **A frame arrives.** The browser hands over each camera frame together with `captureTime`,
   its estimate of when the camera actually captured it.
2. **Landmarks.** MediaPipe's Face Landmarker finds one face and returns 478 points. Only the
   eye landmarks are used, and only to decide where to cut. If no face is found, the frame
   produces no gaze estimate, so gaps in `saccade_data` mean something.
3. **The crop.** The frame is cut to a single strip spanning both eyes, resized to 144 × 36,
   converted to grayscale, and contrast-equalised with CLAHE. That strip is the model's entire
   input. Everything else, including colour and the rest of the face, is discarded. CLAHE is
   what makes ordinary room lighting workable; it cannot rescue backlighting, where the eyes are
   in shadow to begin with.
4. **The embedding.** The strip goes through a small convolutional network (about 20 MB, ONNX,
   run on WebGPU or WebAssembly) that returns 128 numbers describing the appearance of the eyes.
   This model is trained once, on a large webcam dataset, and is the same for everybody.
5. **Smoothing.** The last few embeddings are averaged before predicting, which is much less
   jumpy than a single frame. The number averaged is the `tta` setting, 5 by default. Because
   the estimate comes from several frames, its timestamp is the mean of their capture times.
6. **The ridge.** A ridge regression maps the averaged embedding to a point on the screen. This
   is the only part fitted per participant, which is why calibration takes twenty seconds rather
   than several minutes.

## Calibration and validation

Calibration shows a target, waits a settle interval for the eyes to arrive, then collects
embeddings for a capture interval and averages them into one observation. Thirteen points at
1.5 s each is the default.

The regression has 128 coefficients and a dozen or so observations, so it needs the ridge
penalty to keep it from chasing noise in a few points. The penalty is chosen from the number of
points unless you set `lambda` yourself.

Validation uses a different grid, inset from the calibration grid. Scoring on the points you
fitted measures the fit rather than the participant, and flatters you by a wide margin, so the
nine held-out points are the number to report.

## The timing loopback

A camera frame's timestamp is not when the light left the screen. Between the two sit the
display's own latency and the camera's pipeline, together usually 50 to 150 ms, and neither is
visible from JavaScript.

The loopback measures the two together. For fifteen seconds the page steps between black and
white at random intervals of half a second or more, while the camera watches the screen. Each
flip time is recorded, each frame's brightness is stamped with its capture time, and the lag is
the shift that best aligns the two sequences. Any lag within one camera frame period fits the
data equally well, so the estimator returns the centre of that interval plus its width, and a
verdict saying whether the measurement held together.

The random schedule matters: a fixed rate would land at the same phase of the camera's frame
clock every time and bias the estimate. It also means the screen changes at most twice a second,
far below any photosensitivity threshold.

## What limits accuracy

In rough order of how much they matter:

1. **Head movement after calibration.** The fitted map assumes the head pose that was there
   during calibration.
2. **Lighting.** Front light is good, side light is workable, backlight is not.
3. **Glasses.** Reflections can hide the eye region for a range of head angles.
4. **Camera frame rate.** A 30 fps camera bounds your temporal resolution at 33 ms.

Measure it on every participant with [`saccade-validate`](../reference/plugin-validate) and
report the distribution.
