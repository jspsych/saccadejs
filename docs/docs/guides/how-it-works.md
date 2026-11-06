---
id: how-it-works
title: How it works
sidebar_label: How it works
description: The pipeline from a camera frame to a point on the screen, in one page.
---

# How it works

You do not need this page to use saccade.js. Read it when you are writing the methods section of a
paper, or when you want to understand why the tracker behaves the way it does.

In brief, a model trained once, in advance, turns a picture of the eyes into a list of numbers
that describe how the eyes look. Calibration then learns how those numbers map onto positions on
this participant's screen.

## From a camera frame to a point on the screen

Every camera frame goes through the same six steps. Terms you may want for a methods section
appear in parentheses.

1. **The camera captures a frame.** Along with the image, the browser reports when it thinks the
   camera captured it (`captureTime`). saccade.js stamps gaze samples with this time.

2. **Find the face.** Google's MediaPipe Face Landmarker looks for one face and marks 478 points on
   it (landmarks). saccade.js uses only the points around the eyes, and only to decide where to
   cut the image. A frame with no face produces no gaze estimate, so a gap in `saccade_data`
   tells you something: the participant blinked, looked away, or left the frame.

3. **Cut out the eyes.** saccade.js crops the frame to a single strip covering both eyes, converts
   it to grayscale, and shrinks it to 144 × 36 pixels. It then adjusts the contrast region by
   region (CLAHE, contrast-limited adaptive histogram equalization) to even out differences in
   lighting between rooms. The model sees only this small strip. Color and the rest of the face
   are thrown away.

   Contrast adjustment cannot restore detail the camera never captured. If a lamp behind the
   participant leaves their eyes in shadow, the strip will be dark and noisy.

4. **Describe the eyes as numbers.** A small neural network (a convolutional network, about 20 MB,
   in ONNX format) reads the strip and returns 128 numbers that together describe how the eyes
   look in this frame (an embedding). It also returns a usability rating between 0 and 1. A frame
   caught mid-blink, for example, gets a low rating.

   The network was trained once, on a large collection of webcam images, and is the same for
   every participant. It learns nothing in the participant's browser. It runs on the graphics
   card when the browser allows it (WebGPU) and on the slower processor otherwise (WebAssembly).

   In [deferred mode](deferred-mode), this step runs later, in background threads on the
   processor, while the experiment carries on. Steps 5 and 6 run once it finishes. The
   `saccade_mode` column records which mode a trial used.

5. **Optionally, average a few frames.** A single frame's estimate can be jumpy, so saccade.js can
   average the numbers from the last few frames to steady it. Each frame counts in proportion to
   its usability rating, so a blink barely moves the estimate. The `smoothing_frames` setting
   controls how many frames go into the average. The default, 1, means no averaging. If you raise
   it, each estimate is stamped with the average capture time of its frames, and estimates lag
   slightly behind the participant's eyes.

6. **Turn the numbers into a screen position.** A linear equation, fitted to this participant
   during calibration, converts the 128 numbers into an `x` and a `y` on the screen (ridge
   regression). This equation is the only part of the system specific to the participant. It is
   quick to fit, which is why calibration takes about twenty seconds instead of minutes.

## Calibration and validation

**Calibration** fits the equation in step 6. saccade.js shows a dot, waits one second for the
participant's eyes to reach it, then records the eye numbers for half a second. Each frame
recorded, paired with the dot's position, becomes one example. The default thirteen dots at 30
frames a second give a few hundred examples. The frames for one dot all share a gaze position, so
whatever differs between them is noise, and the fit learns to ignore it.

The usability rating sets how much each frame counts toward the fit: a frame caught mid-blink
counts for less than a clean one. The calibration trial records whether it used this weighting in
a `weighting` column. Report it, because a weighted fit and an unweighted fit are different
analyses and nothing else in the data tells them apart.

The equation has 128 coefficients for each of `x` and `y`, one per number the model produces, but
the examples come from only about a dozen dots. An ordinary least-squares fit would match those
dots perfectly and predict everything else badly. Ridge regression prevents this by adding a
penalty that keeps the coefficients small. The penalty is 3 unless you set `lambda` yourself.

Before version 0.4.0, `@saccadejs/core` averaged each dot's frames into a single example. That fit
is still available as `fit: "points"`, for reproducing earlier data. The calibration trial records
which fit ran in a `fit` column. Report it alongside `weighting`.

**Validation** checks the result on a second set of nine dots, set in from the edges of the screen.
Eight of them sit where calibration never put a dot, and the ninth is at the center. The new
positions matter. Error measured on the calibration dots shows how well the equation fits the
examples it was built from, which always looks better than how it does on new ones. Report the
error on the validation dots.

## Measuring the screen-to-camera delay

A camera frame's timestamp lags behind the moment the screen changed. The monitor takes time to
show a new image, and the camera takes time to capture and deliver a frame. JavaScript can see
neither.

The `saccade-time-sync` trial measures the two together:

1. For fifteen seconds, the page switches between black and white at random moments, at least half
   a second apart.
2. saccade.js records the time of each switch.
3. Meanwhile, the participant's face and surroundings brighten and darken with the screen.
   saccade.js records how bright each camera frame is and when the camera captured it.
4. The delay is the time shift that best lines up the switches with the jumps in brightness.

The camera takes a picture only every 33 ms or so, so any delay within that window lines up
equally well. saccade.js reports the middle of the window as the delay, the window's width as its
uncertainty, and a verdict on whether to trust the measurement.

The switches come at random times on purpose. At a steady rate, every switch would land at the
same point in the camera's rhythm, and the error would pile up in one direction. The half-second
minimum gap keeps the screen to at most two changes a second, under the limit of three flashes a
second that the web accessibility guidelines (WCAG) set to protect people with photosensitive
epilepsy.

## What limits accuracy

These limits follow from how the method works. Nobody has yet measured how much accuracy each one
costs.

1. **Moving the head after calibration.** The calibration equation assumes the head stays where it
   was during calibration. Leaning in or turning changes how the eyes look for the same point on
   the screen.
2. **Lighting.** The model sees only the eye strip. A window or lamp behind the participant that
   leaves the eyes dark removes what the model needs.
3. **Glasses.** Reflections on lenses can hide the eyes at some head angles.
4. **Camera frame rate.** The tracker produces at most one estimate per camera frame. At 30 frames
   per second that is one every 33 ms, so you cannot time an event more finely than that.

These vary from participant to participant, so measure accuracy for every participant with
[`saccade-validate`](../reference/plugin-validate) and report the distribution across your sample.
