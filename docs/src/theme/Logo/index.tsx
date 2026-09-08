import React from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useThemeConfig} from '@docusaurus/theme-common';
import type {Props} from '@theme/Logo';
import SaccadeMark from '@site/src/components/SaccadeMark';

/**
 * Site-level Logo swizzle, overriding the one in @jspsych/docusaurus-theme.
 *
 * Identical to the theme's version — same home link, alt-text rules, and the
 * navbar__brand / navbar__logo / navbar__title class hooks the theme expects —
 * except the mark is saccade.js's scanpath rather than the shared jsPsych
 * dot-brain. It stays inlined as SVG rather than a flat <img> so the path can
 * draw itself on hover (see components/SaccadeMark).
 *
 * The brand uses one full-colour mark in both colour modes (no srcDark
 * configured), so there is no themed-image switching to preserve.
 */
export default function Logo(props: Props): React.ReactElement {
  const {
    siteConfig: {title},
  } = useDocusaurusContext();
  const {
    navbar: {title: navbarTitle, logo},
  } = useThemeConfig();
  const {imageClassName, titleClassName, ...propsRest} = props;
  const logoLink = useBaseUrl(logo?.href || '/');
  // If a visible title is shown, the mark is decorative → empty alt.
  const fallbackAlt = navbarTitle ? '' : title;
  const alt = logo?.alt ?? fallbackAlt;

  return (
    <Link
      to={logoLink}
      {...propsRest}
      {...(logo?.target && {target: logo.target})}>
      <div className={imageClassName}>
        <SaccadeMark
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
        />
      </div>
      {navbarTitle != null && <b className={titleClassName}>{navbarTitle}</b>}
    </Link>
  );
}
