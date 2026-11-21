import { hasLargeMediaSurface } from '../detector';
import {
  EXTENSION_STYLE_ID,
  FILTER_STYLE_ID,
  ROOT_SCHEME_ATTR,
} from '../css-utils';
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

const MAX_WAIT_MS = 4000;

function waitForLoadOrTimeout(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    if (doc.readyState === 'complete') {
      resolve();
      return;
    }
    const timer = setTimeout(finish, MAX_WAIT_MS);
    function finish(): void {
      clearTimeout(timer);
      window.removeEventListener('load', finish);
      resolve();
    }
    window.addEventListener('load', finish, { once: true });
  });
}

export const filterFallbackStrategy: PageThemeStrategy = {
  id: 'filter',

  async apply(page: PageContext): Promise<StrategyResult> {
    if (hasLargeMediaSurface(page.document)) {
      return 'continue';
    }

    // Give stylesheets still being fetched a chance: if the recolor pass has
    // produced overrides by load time, inverting on top would double-darken.
    await waitForLoadOrTimeout(page.document);
    const overrideEl = page.document.getElementById(EXTENSION_STYLE_ID);
    const adoptedOverrides = page.document.adoptedStyleSheets?.some(
      (sheet) => {
        try {
          return sheet.cssRules.length > 0;
        } catch {
          return false;
        }
      },
    );
    if (overrideEl?.textContent?.trim() || adoptedOverrides) {
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
