/**
 * The full-viewport calibration/validation target: a masked background, a white dot, and a ring
 * that shrinks onto the dot while the participant settles and turns green while gaze is captured.
 * Ported from `web/demo/src/{ui.ts,style.css}` in the eye-tracking reference implementation.
 */

const STYLE_ID = "saccade-target-style";

const CSS = `
.saccade-target-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  background: #111;
  overflow: hidden;
  cursor: default;
}
.saccade-target {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
  display: none;
}
.saccade-target.saccade-visible { display: block; }
.saccade-target.saccade-clickable { pointer-events: auto; cursor: pointer; }
.saccade-target-dot {
  position: absolute;
  border-radius: 50%;
  background: #fff;
}
.saccade-target-ring {
  position: absolute;
  box-sizing: border-box;
  border-radius: 50%;
  border: 3px solid #38bdf8;
  opacity: 0.9;
}
.saccade-target.saccade-settle .saccade-target-ring {
  animation: saccade-target-shrink var(--saccade-settle, 1000ms) linear forwards;
}
.saccade-target.saccade-capture .saccade-target-ring {
  transform: scale(0.25);
  border-color: #4ade80;
}
@keyframes saccade-target-shrink {
  from { transform: scale(1); }
  to { transform: scale(0.25); }
}
.saccade-target-message {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: #eee;
  font: 15px/1.5 system-ui, sans-serif;
  text-align: center;
  max-width: 640px;
}
`;

export type TargetPhase = "idle" | "settle" | "capture";

export class TargetUi {
  readonly overlay: HTMLDivElement;
  private target: HTMLDivElement;
  private ring: HTMLDivElement;
  private dot: HTMLDivElement;

  constructor(parent: HTMLElement, pointSize: number) {
    injectTargetStyle();

    this.overlay = document.createElement("div");
    this.overlay.className = "saccade-target-overlay";

    this.target = document.createElement("div");
    this.target.className = "saccade-target";

    const ringSize = pointSize * 4;
    this.ring = document.createElement("div");
    this.ring.className = "saccade-target-ring";
    this.ring.style.width = `${ringSize}px`;
    this.ring.style.height = `${ringSize}px`;
    this.ring.style.left = `${-ringSize / 2}px`;
    this.ring.style.top = `${-ringSize / 2}px`;

    this.dot = document.createElement("div");
    this.dot.className = "saccade-target-dot";
    this.dot.style.width = `${pointSize}px`;
    this.dot.style.height = `${pointSize}px`;
    this.dot.style.left = `${-pointSize / 2}px`;
    this.dot.style.top = `${-pointSize / 2}px`;

    this.target.append(this.ring, this.dot);
    this.overlay.append(this.target);
    parent.append(this.overlay);
  }

  /** The target element itself — attach click listeners here in `"click"` mode. */
  get element(): HTMLDivElement {
    return this.target;
  }

  /** Position the target. `left`/`top` are CSS lengths, e.g. `"50%"` or `"calc(50% + 200px)"`. */
  moveTo(left: string, top: string): void {
    this.target.style.left = left;
    this.target.style.top = top;
    this.target.classList.add("saccade-visible");
  }

  /** Set the animation phase. Restarting `"settle"` restarts the shrink animation. */
  setPhase(phase: TargetPhase, settleMs = 1000): void {
    this.target.classList.remove("saccade-settle", "saccade-capture");
    this.target.style.setProperty("--saccade-settle", `${settleMs}ms`);
    // Force a reflow so re-adding the class restarts the CSS animation.
    void this.target.offsetWidth;
    if (phase === "settle") this.target.classList.add("saccade-settle");
    if (phase === "capture") this.target.classList.add("saccade-capture");
  }

  setClickable(clickable: boolean): void {
    this.target.classList.toggle("saccade-clickable", clickable);
  }

  hide(): void {
    this.target.classList.remove("saccade-visible", "saccade-settle", "saccade-capture");
  }

  /** Replace the overlay's contents with a centered message (used for errors). */
  showMessage(html: string): void {
    this.overlay.innerHTML = `<div class="saccade-target-message">${html}</div>`;
  }

  destroy(): void {
    this.overlay.remove();
  }
}

function injectTargetStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
