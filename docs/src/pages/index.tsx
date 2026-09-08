import React from "react";
import clsx from "clsx";
import Layout from "@theme/Layout";
import CodeBlock from "@theme/CodeBlock";
import Link from "@docusaurus/Link";
import SaccadeMark from "@site/src/components/SaccadeMark";
import styles from "./index.module.css";

/** Stroke icons, drawn to the same 24×24 / 1.75-weight grid as the jsPsych sites. */
function Icon({
  className,
  size = 24,
  children,
}: {
  className?: string;
  size?: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const EyeIcon = ({ className }: { className?: string }) => (
  <Icon className={className} size={20}>
    <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

const CodeIcon = ({ className }: { className?: string }) => (
  <Icon className={className} size={20}>
    <polyline points="8 6 3 12 8 18" />
    <polyline points="16 6 21 12 16 18" />
  </Icon>
);

const TargetIcon = ({ className }: { className?: string }) => (
  <Icon className={className} size={28}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2" />
    <line x1="12" y1="1.5" x2="12" y2="5" />
    <line x1="12" y1="19" x2="12" y2="22.5" />
    <line x1="1.5" y1="12" x2="5" y2="12" />
    <line x1="19" y1="12" x2="22.5" y2="12" />
  </Icon>
);

const GridIcon = ({ className }: { className?: string }) => (
  <Icon className={className} size={28}>
    <circle cx="5" cy="5" r="1.4" />
    <circle cx="12" cy="5" r="1.4" />
    <circle cx="19" cy="5" r="1.4" />
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="2.6" />
    <circle cx="19" cy="12" r="1.4" />
    <circle cx="5" cy="19" r="1.4" />
    <circle cx="12" cy="19" r="1.4" />
    <circle cx="19" cy="19" r="1.4" />
  </Icon>
);

const ClockIcon = ({ className }: { className?: string }) => (
  <Icon className={className} size={28}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 6.5 12 12 15.5 14" />
  </Icon>
);

function Hero(): React.ReactElement {
  return (
    <header className={styles.hero}>
      <div className={styles.heroRow}>
        <div className={styles.heroCopy}>
          {/* `navbar__brand` is the hover hook that makes the scanpath draw
              itself; see components/SaccadeMark. */}
          <span className={clsx("navbar__brand", styles.heroLogo)}>
            <SaccadeMark className={styles.heroMark} />
          </span>
          <div className={styles.heroText}>
            <h1 className={styles.heroTitle}>
              <span className={styles.heroTitleAccent}>saccade.js</span>{" "}
              estimates where a participant is looking, from an ordinary
              webcam.
            </h1>
            <p className={styles.heroLede}>
              It runs in the browser as a jsPsych extension: attach it to a
              trial, and that trial's data gains a gaze sample for every camera
              frame. The core library also runs on its own, without jsPsych.
            </p>
            <p className={styles.heroNote}>
              The model that estimates gaze is trained once and ships with the
              library, so nothing is trained in the browser. Only a ridge
              regression is fitted to each participant, which is why calibration
              takes about twenty seconds. The median error afterwards is roughly
              a tenth of the screen: enough to distinguish quadrants and
              well-separated regions of interest, not enough for reading or
              small stimuli. No video leaves the participant's computer.
            </p>
          </div>
        </div>

        <div className={styles.heroPaths}>
          <div className={styles.pathList}>
            <div className={styles.pathCard}>
              <div className={styles.pathCardHead}>
                <EyeIcon className={styles.pathCardIcon} />
                <h2 className={styles.pathCardTitle}>Live demo</h2>
              </div>
              <p className={styles.pathCardDesc}>
                Camera setup, calibration and validation, running in this page
                with your own webcam.
              </p>
              <div className={styles.pathCardActions}>
                <Link className="button button--primary" to="/demo">
                  Open the live demo
                </Link>
                <Link className={styles.pathLink} to="/guides/how-it-works">
                  How it works →
                </Link>
              </div>
            </div>

            <div className={styles.pathCard}>
              <div className={styles.pathCardHead}>
                <CodeIcon className={styles.pathCardIcon} />
                <h2 className={styles.pathCardTitle}>Use it in an experiment</h2>
              </div>
              <p className={styles.pathCardDesc}>
                The extension records gaze during any trial. One plugin handles
                each setup step: camera, calibration, validation and timing.
              </p>
              <div className={styles.pathCardActions}>
                <Link className={styles.pathLink} to="/getting-started">
                  Getting started →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function Features(): React.ReactElement {
  return (
    <section className={styles.features}>
      <p className={styles.eyebrow}>What it records</p>
      <div className={styles.featureGrid}>
        <div>
          <TargetIcon className={styles.featureIcon} />
          <h2 className={styles.featureTitle}>Gaze samples</h2>
          <p className={styles.featureBody}>
            A trial with the extension attached records one <code>x</code>,{" "}
            <code>y</code>, <code>t</code> row per camera frame in which a face
            was found. Coordinates are viewport pixels in the participant's own
            window. The position of any element you name is recorded with them,
            so samples can be tested against it directly.
          </p>
        </div>
        <div>
          <GridIcon className={styles.featureIcon} />
          <h2 className={styles.featureTitle}>Calibration and validation</h2>
          <p className={styles.featureBody}>
            Calibration fits a ridge regression on thirteen points. Validation
            measures the result on nine points the calibration did not use, and
            reports the median error in viewport units, which is comparable
            across screen sizes.
          </p>
        </div>
        <div>
          <ClockIcon className={styles.featureIcon} />
          <h2 className={styles.featureTitle}>Timing correction</h2>
          <p className={styles.featureBody}>
            A camera frame arrives 50 to 150 ms after the screen changed, and
            the delay differs from machine to machine. The{" "}
            <code>saccade-time-sync</code> plugin measures it for each
            participant and subtracts it from every gaze timestamp.
          </p>
        </div>
      </div>
    </section>
  );
}

const TIMELINE_SAMPLE = `const jsPsych = initJsPsych({
  extensions: [{ type: jsPsychExtensionSaccade }],
});

jsPsych.run([
  { type: jsPsychSaccadePreview },     // camera and model
  { type: jsPsychSaccadeCalibrate },   // 13 points
  { type: jsPsychSaccadeValidate },    // 9 held-out points
  {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<img id="face" src="face.png">',
    extensions: [
      { type: jsPsychExtensionSaccade, params: { targets: ["#face"] } },
    ],
  },
]);`;

function InYourTimeline(): React.ReactElement {
  return (
    <section className={styles.timeline}>
      <div className={styles.timelineCard}>
        <div className={styles.timelineText}>
          <p className={styles.eyebrow}>Example</p>
          <h2 className={styles.timelineTitle}>A minimal experiment</h2>
          <p className={styles.timelineBody}>
            The setup steps are ordinary jsPsych trials, placed in the timeline
            wherever they are needed. Recording is enabled one trial at a time
            by attaching the extension, so any plugin can present the stimulus.
          </p>
          <Link className="button button--primary" to="/getting-started">
            Getting started →
          </Link>
        </div>
        <div className={styles.timelineCode}>
          <CodeBlock language="js">{TIMELINE_SAMPLE}</CodeBlock>
        </div>
      </div>
    </section>
  );
}

const PACKAGES = [
  {
    name: "@saccadejs/core",
    to: "/reference/core-api",
    what: "Tracker, calibration, validation, timing loopback. No jsPsych dependency.",
  },
  {
    name: "@saccadejs/extension",
    to: "/reference/extension",
    what: "Records a gaze sample per camera frame during any trial.",
  },
  {
    name: "@saccadejs/plugin-preview",
    to: "/reference/plugin-preview",
    what: "Starts the camera and lets the participant position themselves.",
  },
  {
    name: "@saccadejs/plugin-performance",
    to: "/reference/plugin-performance",
    what: "Measures the effective frame rate, and can exclude machines that are too slow.",
  },
  {
    name: "@saccadejs/plugin-time-sync",
    to: "/reference/plugin-time-sync",
    what: "Measures screen-to-camera lag and applies it to gaze timestamps.",
  },
  {
    name: "@saccadejs/plugin-calibrate",
    to: "/reference/plugin-calibrate",
    what: "Calibration trial.",
  },
  {
    name: "@saccadejs/plugin-validate",
    to: "/reference/plugin-validate",
    what: "Validation trial.",
  },
];

const REQUIREMENTS = [
  {
    what: "Chrome or Edge",
    detail:
      "on a laptop or desktop. Other browsers run the tracker, but may not supply the camera capture timestamps that the timing measurement needs.",
  },
  {
    what: "A webcam",
    detail: "and a page served over https:// or localhost.",
  },
  {
    what: "WebGPU",
    detail:
      "for full frame rate. Without it the model runs on WebAssembly, more slowly.",
  },
  {
    what: "About 25 MB",
    detail:
      "downloaded on a participant's first visit, cached by the browser afterwards.",
  },
];

function Details(): React.ReactElement {
  return (
    <section className={styles.details}>
      <div className={styles.detailsGrid}>
        <div>
          <p className={styles.eyebrow}>What you need</p>
          <ul className={styles.needList}>
            {REQUIREMENTS.map((r) => (
              <li key={r.what}>
                <strong>{r.what}</strong> {r.detail}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className={styles.eyebrow}>The packages</p>
          <ul className={styles.packageList}>
            {PACKAGES.map((p) => (
              <li key={p.name}>
                <Link className={styles.packageName} to={p.to}>
                  {p.name}
                </Link>
                <span className={styles.packageWhat}>{p.what}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default function Home(): React.ReactElement {
  return (
    <Layout description="saccade.js estimates where a participant is looking from an ordinary webcam, in the browser. It provides a jsPsych extension, plugins for camera setup, calibration, validation and timing, and a core library that runs without jsPsych.">
      <main>
        <Hero />
        <Features />
        <InYourTimeline />
        <Details />
      </main>
    </Layout>
  );
}
