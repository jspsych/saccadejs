import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

/**
 * One sidebar per navbar tab. Introduction, the live demo and Getting started are single
 * pages linked directly from the navbar, so they have no sidebar of their own: they run
 * full width, and their own headings are the only navigation they need.
 */
const sidebars: SidebarsConfig = {
  guides: [
    "guides/browser-compatibility",
    "guides/timing-and-synchrony",
    "guides/hosting-the-assets",
    "guides/how-it-works",
  ],
  reference: [
    "models",
    "reference/extension",
    {
      type: "category",
      label: "Plugins",
      collapsed: false,
      items: [
        "reference/plugin-preview",
        "reference/plugin-performance",
        "reference/plugin-time-sync",
        "reference/plugin-calibrate",
        "reference/plugin-validate",
      ],
    },
    "reference/core-api",
  ],
};

export default sidebars;
