import {
  hasFrameworkRoot,
  samplePageIsDark,
} from '../detector';
import {
  EXTENSION_STYLE_ID,
  FILTER_STYLE_ID,
  ROOT_SCHEME_ATTR,
} from '../css-utils';
import type { PageContext, PageThemeStrategy, StrategyResult } from '../types';

function waitFor(event: 'DOMContentLoaded' | 'load'): Promise<void> {
  return new Promise((resolve) => {
    if (
      event === 'DOMContentLoaded' &&
      document.readyState !== 'loading'
    ) {
      resolve();
      return;
    }
    if (event === 'load' && document.readyState === 'complete') {
      resolve();
      return;
    }
    window.addEventListener(event, () => resolve(), { once: true });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withSheetsDisabled<T>(fn: () => T): T {
  const sheets = [
    document.getElementById(EXTENSION_STYLE_ID),
    document.getElementById(FILTER_STYLE_ID),
  ].filter(Boolean) as HTMLStyleElement[];

  for (const sheet of sheets) {
    sheet.disabled = true;
  }
  try {
    return fn();
  } finally {
    for (const sheet of sheets) {
      sheet.disabled = false;
    }
  }
}

/**
 * Native scheme strategy assumes the MAIN-world script already forced
 * prefers-color-scheme: dark. This strategy only samples whether the page
 * ended up dark and reports handled if so.
 */
export const nativeSchemeStrategy: PageThemeStrategy = {
  id: 'native',

  async apply(page: PageContext): Promise<StrategyResult> {
    page.document.documentElement.setAttribute(ROOT_SCHEME_ATTR, 'pending');
    page.document.documentElement.style.setProperty('color-scheme', 'dark');

    await waitFor('DOMContentLoaded');

    const check = () =>
      withSheetsDisabled(() => samplePageIsDark(page.document));

    if (check()) {
      page.document.documentElement.setAttribute(ROOT_SCHEME_ATTR, 'native');
      return 'handled';
    }

    await waitFor('load');
    if (check()) {
      page.document.documentElement.setAttribute(ROOT_SCHEME_ATTR, 'native');
      return 'handled';
    }

    if (hasFrameworkRoot(page.document)) {
      await delay(500);
      if (check()) {
        page.document.documentElement.setAttribute(ROOT_SCHEME_ATTR, 'native');
        return 'handled';
      }
    }

    return 'continue';
  },

  revert(page: PageContext): void {
    page.document.documentElement.removeAttribute(ROOT_SCHEME_ATTR);
    page.document.documentElement.style.removeProperty('color-scheme');
  },
};
