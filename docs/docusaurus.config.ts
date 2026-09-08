import type { Config } from "@docusaurus/types";
import { defineJspsychConfig } from "@jspsych/docusaurus-preset";

const editUrl = "https://github.com/jspsych/saccadejs/tree/main/docs/";

// The site is served at the root of its own domain, so this is just "/". Kept as a constant
// because raw-HTML strings (e.g. an announcement bar) and the config's own `to:` fields do not
// go through `useBaseUrl` the way MDX links do — interpolate this rather than hardcoding "/",
// so a future move back under a path prefix stays a one-line change.
const baseUrl = "/";

const config: Config = defineJspsychConfig({
  title: "saccade.js",
  tagline: "Webcam eye tracking in the browser, with timing you can defend",
  // Custom domain, set by docs/static/CNAME and the repository's Pages settings.
  url: "https://saccade.jspsych.org",
  baseUrl,
  organizationName: "jspsych",
  projectName: "saccadejs",
  githubUrl: "https://github.com/jspsych/saccadejs",
  favicon: "img/saccadejs-icon.svg",

  docs: {
    sidebarPath: "./sidebars.ts",
    // Docs at the root of the site; the landing page is src/pages/index.tsx.
    routeBasePath: "/",
    editUrl,
    showLastUpdateTime: true,
  },

  navbar: {
    title: "saccade.js",
    items: [
      { to: "/demo", label: "Live demo", position: "left" },
      { to: "/getting-started", label: "Getting started", position: "left" },
      {
        type: "docSidebar",
        sidebarId: "guides",
        label: "Guides",
        position: "left",
      },
      {
        type: "docSidebar",
        sidebarId: "reference",
        label: "Reference",
        position: "left",
      },
    ],
  },

  footerLinks: [
    {
      title: "Docs",
      items: [
        { label: "Home", to: "/" },
        { label: "Live demo", to: "/demo" },
        { label: "Getting started", to: "/getting-started" },
        { label: "Reference", to: "/reference/core-api" },
      ],
    },
    {
      title: "Community",
      items: [
        {
          label: "Discussions",
          href: "https://github.com/jspsych/jsPsych/discussions",
        },
        {
          label: "Issues",
          href: "https://github.com/jspsych/saccadejs/issues",
        },
      ],
    },
    {
      title: "More",
      items: [
        { label: "GitHub", href: "https://github.com/jspsych/saccadejs" },
        { label: "jsPsych", href: "https://www.jspsych.org" },
      ],
    },
  ],
});

export default config;
