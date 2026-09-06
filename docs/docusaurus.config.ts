import type { Config } from "@docusaurus/types";
import { defineJspsychConfig } from "@jspsych/docusaurus-preset";

const editUrl = "https://github.com/jspsych/saccadejs/tree/main/docs/";

// The site is published to a project page, so every absolute link needs this prefix.
// MDX links go through `useBaseUrl`, but raw-HTML strings (e.g. an announcement bar) and
// the config's own `to:` fields do not — interpolate this rather than hardcoding "/".
const baseUrl = "/saccadejs/";

const config: Config = defineJspsychConfig({
  title: "saccade.js",
  tagline: "Webcam eye tracking in the browser, with timing you can defend",
  // No CNAME yet: the site lives on the GitHub Pages project domain. See docs/README.md
  // for what to change when a custom domain is set up.
  url: "https://jspsych.github.io",
  baseUrl,
  organizationName: "jspsych",
  projectName: "saccadejs",
  githubUrl: "https://github.com/jspsych/saccadejs",

  docs: {
    sidebarPath: "./sidebars.ts",
    // Docs-only site: the Introduction page is the landing page.
    routeBasePath: "/",
    editUrl,
    showLastUpdateTime: true,
  },

  navbar: {
    title: "saccade.js",
    items: [
      { to: "/", label: "Introduction", position: "left", activeBaseRegex: "^/saccadejs/$" },
      { to: "/demo", label: "Live demo", position: "left" },
      {
        type: "docSidebar",
        sidebarId: "gettingStarted",
        label: "Getting started",
        position: "left",
      },
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
        { label: "Introduction", to: "/" },
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
