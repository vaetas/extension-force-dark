import { hasLargeMediaSurface } from '../detector';
import { FILTER_STYLE_ID, ROOT_SCHEME_ATTR } from '../css-utils';
import type { PageContext, PageThemeStrategy, StrategyResult } from '../types';

const FILTER_CSS = `
html[${ROOT_SCHEME_ATTR}="filter"] {
  background-color: #111 !important;
  filter: invert(0.9) hue-rotate(180deg) !important;
}
html[${ROOT_SCHEME_ATTR}="filter"] img,
html[${ROOT_SCHEME_ATTR}="filter"] video,
html[${ROOT_SCHEME_ATTR}="filter"] canvas,
html[${ROOT_SCHEME_ATTR}="filter"] picture,
html[${ROOT_SCHEME_ATTR}="filter"] svg image {
  filter: invert(1) hue-rotate(180deg) !important;
}
`;

export const filterFallbackStrategy: PageThemeStrategy = {
  id: 'filter',

  apply(page: PageContext): StrategyResult {
    if (hasLargeMediaSurface(page.document)) {
      return 'continue';
    }

    let style = page.document.getElementById(
      FILTER_STYLE_ID,
    ) as HTMLStyleElement | null;
    if (!style) {
      style = page.document.createElement('style');
      style.id = FILTER_STYLE_ID;
      (page.document.head ?? page.document.documentElement).appendChild(style);
    }
    style.textContent = FILTER_CSS;
    page.document.documentElement.setAttribute(ROOT_SCHEME_ATTR, 'filter');
    return 'handled';
  },

  revert(page: PageContext): void {
    page.document.getElementById(FILTER_STYLE_ID)?.remove();
    if (
      page.document.documentElement.getAttribute(ROOT_SCHEME_ATTR) === 'filter'
    ) {
      page.document.documentElement.removeAttribute(ROOT_SCHEME_ATTR);
    }
  },
};
