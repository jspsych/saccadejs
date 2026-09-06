import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

/**
 * One sidebar per navbar tab. Introduction and the live demo are single pages linked
 * directly from the navbar, so they have no sidebar of their own.
 */
const sidebars: SidebarsConfig = {
  gettingStarted: ["getting-started"],
  guides: [
    "guides/timing-and-synchrony",
    "guides/migrating-from-webgazer",
    "guides/hosting-the-assets",
    "guides/how-it-works",
  ],
  reference: [
    "reference/core-api",
    "reference/extension",
    {
      type: "category",
      label: "Plugins",
      collapsed: false,
      items: [
        "reference/plugin-preview",
        "reference/plugin-time-sync",
        "reference/plugin-calibrate",
        "reference/plugin-validate",
      ],
    },
  ],
};

export default sidebars;
