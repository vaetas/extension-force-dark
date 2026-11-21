import { hasFrameworkRoot, samplePageIsDark } from '../detector';
import {
  EXTENSION_STYLE_ID,
  FLASH_STYLE_ID,
  INVERT_STYLE_ID,
  ROOT_SCHEME_ATTR,
  SCHEME_ATTR,
  SCHEME_READY_ATTR,
} from '../css-utils';
import type { PageContext, PageThemeStrategy, StrategyResult } from '../types';

function whenParsed(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    if (doc.readyState !== 'loading') {
      resolve();
      return;
    }
    doc.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withSheetsDisabled<T>(doc: Document, fn: () => T): T {
  const sheets = [EXTENSION_STYLE_ID, INVERT_STYLE_ID, FLASH_STYLE_ID]
    .map((id) => doc.getElementById(id))
    .filter(Boolean) as HTMLStyleElement[];
  for (const sheet of sheets) sheet.disabled = true;
  try {
    return fn();
  } finally {
    for (const sheet of sheets) sheet.disabled = false;
  }
}

/**
 * Ask the page to prefer dark: flips the shared attribute that the MAIN-world
 * script watches (matchMedia + `prefers-color-scheme` rules), then samples
 * whether the page actually ended up dark.
 */
export const nativeSchemeStrategy: PageThemeStrategy = {
  id: 'native',

  async apply(page: PageContext): Promise<StrategyResult> {
    const doc = page.document;
    const root = doc.documentElement;
    root.setAttribute(ROOT_SCHEME_ATTR, 'pending');
    root.setAttribute(SCHEME_ATTR, 'on');
    root.style.setProperty('color-scheme', 'dark');

    if (!root.hasAttribute(SCHEME_READY_ATTR)) {
      try {
        await browser.runtime.sendMessage({ type: 'ENSURE_SCHEME' });
      } catch {
        // Extension context may be gone.
      }
    }

    await whenParsed(doc);
    await delay(60); // let the MAIN script rewrite media rules
    if (withSheetsDisabled(doc, () => samplePageIsDark(doc))) {
      root.setAttribute(ROOT_SCHEME_ATTR, 'native');
      return 'handled';
    }

    if (hasFrameworkRoot(doc)) {
      await delay(500);
      if (withSheetsDisabled(doc, () => samplePageIsDark(doc))) {
        root.setAttribute(ROOT_SCHEME_ATTR, 'native');
        return 'handled';
      }
    }
    return 'continue';
  },

  revert(page: PageContext): void {
    const root = page.document.documentElement;
    root.removeAttribute(SCHEME_ATTR);
    const attr = root.getAttribute(ROOT_SCHEME_ATTR);
    if (attr === 'native' || attr === 'pending') {
      root.removeAttribute(ROOT_SCHEME_ATTR);
    }
    root.style.removeProperty('color-scheme');
  },
};
