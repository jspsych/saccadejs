---
id: how-it-works
title: How it works
sidebar_label: How it works
description: The pipeline from a camera frame to a point on the screen, in one page.
---

# How it works

You do not need this page to use saccade.js. It is for when you are writing the methods section
of a paper, or trying to understand why the tracker is behaving the way it is.

The short version: a model that was trained once, in advance, turns a picture of the eyes into a
list of numbers describing how the eyes look. Calibration then learns, for this one participant,
how those numbers relate to positions on their screen.

## From a camera frame to a point on the screen

Each camera frame goes through the same six steps. Technical terms you may want for a methods
section are in parentheses.

1. **The camera captures a frame.** Along with the image, the browser reports when it thinks the
   camera captured it (`captureTime`). That time is what gaze samples are stamped with.

2. **Find the face.** Google's MediaPipe Face Landmarker looks for one face and marks 478 points on
   it (landmarks). saccade.js uses only the points around the eyes, and only to decide where to
   cut the image. If no face is found, that frame produces no gaze estimate. This is why a gap in
   `saccade_data` means something: the participant blinked, looked away, or left the frame.

3. **Cut out the eyes.** The frame is cropped to a single strip covering both eyes, shrunk to
   144 × 36 pixels, and converted to grayscale. Its contrast is then adjusted region by region
   (CLAHE, contrast-limited adaptive histogram equalization), which evens out differences in
   lighting between rooms. This small strip is the only thing the model ever sees. Color and the
   rest of the face are thrown away.

   Contrast adjustment cannot restore detail the camera never captured. If a lamp behind the
   participant leaves their eyes in shadow, the strip will be dark and noisy no matter what.

4. **Describe the eyes as numbers.** The strip goes through a small neural network (a
   convolutional network, about 20 MB, in ONNX format). The network returns 128 numbers that
   together describe how the eyes look in this frame (an embedding). It also returns one more
   number between 0 and 1 that rates how usable the frame is. A frame caught mid-blink, for
   example, gets a low rating.

   This network was trained once, on a large collection of webcam images, and is identical for
   every participant. Nothing about it is learned in the participant's browser. It runs on the
   graphics card when the browser allows it (WebGPU) and on the processor otherwise
   (WebAssembly), which is slower.

5. **Optionally, average a few frames.** A single frame's estimate can be jumpy. saccade.js can
   average the numbers from the last few frames before making an estimate, which is steadier.
   Frames are weighted by their usability rating, so a blink contributes little instead of
   dragging the estimate with it. The `smoothing_frames` setting controls how many frames are
   averaged. It is 1 by default, meaning no averaging. If you raise it, each estimate is stamped
   with the average capture time of the frames it came from, so estimates lag slightly behind
   what the participant is doing.

6. **Turn the numbers into a screen position.** A linear equation, fitted to this participant
   during calibration, converts the 128 numbers into an `x` and a `y` on the screen (ridge
   regression). This equation is the only part of the system that is specific to the participant.
   Because it is so simple to fit, calibration takes about twenty seconds rather than minutes.

## Calibration and validation

**Calibration** is how step 6 gets fitted. saccade.js shows a dot, waits one second for the
participant's eyes to reach it, then records the eye numbers for half a second and averages them.
That average, paired with the dot's position, becomes one example. The default is thirteen dots,
so thirteen examples.

The frame usability rating is used twice. It weights frames within each dot's average, and it
also sets how much each dot counts toward the final fit. A dot the participant blinked through
counts for less than a clean one. The calibration trial records whether this weighting was used
in a `weighting` column. Report it: a weighted fit and an unweighted fit are different analyses,
and nothing else in the data tells them apart.

A note on the fitting. The equation has 128 coefficients for each of `x` and `y`, one per number
the model produces, but only about a dozen examples to fit them from. Fitted naively, it would
match those dozen examples perfectly and predict everything else badly. Ridge regression adds a
penalty that keeps the coefficients small and prevents this. The strength of the penalty is set
automatically from the number of dots, unless you set `lambda` yourself.

**Validation** checks the result on a second set of nine dots, set in from the edges of the
screen. Eight of the nine are in positions calibration did not use; the ninth is the center of
the screen. Using new positions matters. Measured on the calibration dots themselves, the error
would show how well the equation fits the examples it was built from, which always looks better
than how well it works on new ones. The error on the validation dots is the number to report.

## Measuring the screen-to-camera delay

The timestamp on a camera frame is not the moment the image on screen changed. Between the two
there is the time the monitor takes to show a new image, and the time the camera takes to capture
and deliver a frame. Neither is visible to JavaScript.

The `saccade-time-sync` trial measures the two together, like this:

1. For fifteen seconds, the page switches between black and white at random moments, with at
   least half a second between switches.
2. saccade.js records the exact time of each switch.
3. At the same time, the camera watches the screen, and saccade.js records how bright each camera
   frame is and when it was captured.
4. The delay is the time shift that best lines up the switches with the jumps in brightness.

Because the camera only takes a picture every 33 ms or so, any delay within that window lines up
equally well. saccade.js reports the middle of the window as the delay, the width of the window as
its uncertainty, and a verdict on whether the measurement was trustworthy.

The switches come at random times for a reason. At a steady rate, each switch would land at the
same point in the camera's own rhythm, and the error would pile up in the same direction every
time. The random timing also means the screen changes at most twice a second, far below any
photosensitivity threshold.

## What limits accuracy

Each of the following follows from how the method works. How much each one costs in accuracy has
not been measured.

1. **Moving the head after calibration.** The equation fitted in calibration assumes the head is
   where it was during calibration. Leaning in or turning away changes how the eyes look for the
   same point on the screen.
2. **Lighting.** The model sees only the eye strip. Anything that leaves it dark, such as a window
   or lamp behind the participant, removes what the model has to work with.
3. **Glasses.** Reflections on lenses can hide the eyes at some head angles.
4. **Camera frame rate.** The tracker produces at most one estimate per camera frame. At 30 frames
   per second that is one every 33 ms, so no event can be timed more finely than that.

Because these vary from participant to participant, measure accuracy for every participant with
[`saccade-validate`](../reference/plugin-validate) and report the distribution across your sample.
