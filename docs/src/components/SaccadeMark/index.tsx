import React from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

/**
 * saccade.js scanpath mark.
 *
 * Eye tracking plots gaze the same way jsPsych draws its brain: circles of
 * varying radius. The mark is built from that shared primitive — four fixations
 * joined by three saccades — in the brain's brand colours. Where the brain codes
 * colour by position, this codes it by time (#006838 to #ee4523, early to late,
 * the convention scanpaths are actually coloured by), and radius encodes dwell.
 * The path starts top left and resolves lower right, as a real scan of a scene
 * does.
 *
 * It is drawn for small sizes rather than for detail: radii sit in a narrow band
 * and the stroke is heavy, so it reads as one connected form at 16px instead of
 * dots on wires.
 *
 * On hover the path draws itself in sequence — fixations popping in, saccades
 * extending between them. That is the motion the mark is actually about, which
 * is more than could be said for animating a logo that merely depicts an eye.
 *
 * Geometry is generated, not hand-written; the viewBox is normalised to 0 0 so
 * nothing depends on how a viewBox origin is resolved.
 */
export default function SaccadeMark({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label="saccade.js"
      className={clsx(styles.mark, className)}
      {...props}>
      {/* Butt caps, not round: a round cap paints a zero-length dash as a dot,
          so an undrawn saccade would show a stroke-width blob at its origin
          before its fixation has appeared. Nothing is lost — every line end sits
          well inside its fixation circle (smallest radius 20.8 vs a 7.9 half
          stroke), so the caps are never visible in the finished mark. */}
      <g strokeWidth={15.88} strokeLinecap="butt">
        <line
          className={styles.saccade}
          x1="32.06" y1="52.18" x2="95.22" y2="93.68"
          stroke="#006838"
          style={{['--len' as any]: '75.57', strokeDasharray: 75.57, animationDelay: '280ms'}}
        />
        <line
          className={styles.saccade}
          x1="95.22" y1="93.68" x2="71.76" y2="147.82"
          stroke="#13b24b"
          style={{['--len' as any]: '59.0', strokeDasharray: 59.0, animationDelay: '590ms'}}
        />
        <line
          className={styles.saccade}
          x1="71.76" y1="147.82" x2="161.98" y2="126.17"
          stroke="#f78f1e"
          style={{['--len' as any]: '92.79', strokeDasharray: 92.79, animationDelay: '940ms'}}
        />
        <circle
          className={styles.fixation}
          cx="32.06" cy="52.18" r="26.8" fill="#006838"
          style={{animationDelay: '0ms'}}
        />
        <circle
          className={styles.fixation}
          cx="95.22" cy="93.68" r="20.84" fill="#13b24b"
          style={{animationDelay: '350ms'}}
        />
        <circle
          className={styles.fixation}
          cx="71.76" cy="147.82" r="26.8" fill="#f78f1e"
          style={{animationDelay: '660ms'}}
        />
        <circle
          className={styles.fixation}
          cx="161.98" cy="126.17" r="32.75" fill="#ee4523"
          style={{animationDelay: '1010ms'}}
        />
      </g>
    </svg>
  );
}
