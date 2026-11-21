import type { PageThemeStatus, SiteMode } from '../storage/settings';
import { classifyPage } from './detector';
import { FLASH_STYLE_ID } from './css-utils';
import { cssRecolorStrategy } from './strategies/css-recolor';
import { invertStrategy } from './strategies/invert';
import { nativeSchemeStrategy } from './strategies/native-scheme';
import type { PageContext } from './types';

const VERIFY_TIMEOUT_MS = 4000;
const VERIFY_SETTLE_MS = 700;

export function revertAll(page: PageContext): void {
  invertStrategy.revert(page);
  cssRecolorStrategy.revert(page);
  nativeSchemeStrategy.revert(page);
}

function waitForLoad(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    if (doc.readyState === 'complete') return resolve();
    const win = doc.defaultView ?? window;
    const timer = setTimeout(done, VERIFY_TIMEOUT_MS);
    function done(): void {
      clearTimeout(timer);
      win.removeEventListener('load', done);
      resolve();
    }
    win.addEventListener('load', done, { once: true });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function applyMode(
  page: PageContext,
  mode: SiteMode,
  isCurrent: () => boolean,
): Promise<PageThemeStatus> {
  switch (mode) {
    case 'off':
      return 'off';

    case 'invert':
      // The top frame's filter already covers every nested frame.
      if (page.isTopFrame) invertStrategy.apply(page);
      return 'invert';

    case 'recolor':
      await cssRecolorStrategy.apply(page);
      return 'recolor';

    case 'auto': {
      if ((await nativeSchemeStrategy.apply(page)) === 'handled') {
        return 'native';
      }
      if (!isCurrent()) return 'pending';
      await cssRecolorStrategy.apply(page);
      removeFlash(page.document); // it would mask the page background below

      // Sub-frames follow the top frame; only it may escalate to invert.
      if (!page.isTopFrame) return 'recolor';
      await waitForLoad(page.document);
      await delay(VERIFY_SETTLE_MS);
      if (!isCurrent()) return 'pending';
      if (classifyPage(page.document) === 'light') {
        revertAll(page);
        invertStrategy.apply(page);
        invertStrategy.setReinvertFrames(page.document, true);
        return 'invert';
      }
      return 'recolor';
    }
  }
}

function addFlash(doc: Document): void {
  if (doc.getElementById(FLASH_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = FLASH_STYLE_ID;
  style.textContent =
    'html { background-color: #181a1b !important; color-scheme: dark; }';
  doc.documentElement.appendChild(style);
}

function removeFlash(doc: Document): void {
  doc.getElementById(FLASH_STYLE_ID)?.remove();
}

/** Owns the current mode for one document and serialises mode changes. */
export function createController(
  page: PageContext,
  onStatus: (status: PageThemeStatus) => void,
) {
  let generation = 0;
  let current: SiteMode | null = null;

  return {
    get mode(): SiteMode | null {
      return current;
    },

    async set(next: SiteMode): Promise<void> {
      if (next === current) return;
      current = next;
      const mine = ++generation;
      const isCurrent = (): boolean => generation === mine;
      const doc = page.document;

      revertAll(page);
      removeFlash(doc);
      if (next === 'off') {
        onStatus('off');
        return;
      }

      onStatus('pending');
      if (next !== 'invert') addFlash(doc);
      try {
        const status = await applyMode(page, next, isCurrent);
        if (isCurrent()) onStatus(status);
      } catch (error) {
        console.warn('[ForceDark] apply failed', error);
      } finally {
        if (isCurrent()) removeFlash(doc);
      }
    },
  };
}
