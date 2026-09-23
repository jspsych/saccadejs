---
"@saccadejs/plugin-preview": minor
---

Participant-facing wording in the preview trial:

- The face indicator reads "Face found" or "Looking for your face…" instead of "face: yes/no".
- The loading labels describe what the participant is waiting for. For example, "Downloading the eye tracker (12.3 of 20.6 MB)…" replaces "Downloading eye model 12.3 / 20.6 MB", and "Starting the model runtime" is now "Loading…".
- The frame rate and execution provider are hidden unless the new `show_diagnostics` parameter is `true`. Both are still recorded in the data.
- The loading note and the failure message are reworded in plain language.
