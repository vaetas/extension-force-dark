import { INVERT_STYLE_ID, ROOT_SCHEME_ATTR } from '../css-utils';
import type { PageContext, PageThemeStrategy, StrategyResult } from '../types';

const A = `html[${ROOT_SCHEME_ATTR}="invert"]`;
const REINVERT = 'invert(1) hue-rotate(180deg)';

const INVERT_CSS = `
${A} { background-color: #fff !important; filter: invert(0.92) hue-rotate(180deg) !important; }
${A} img, ${A} video, ${A} canvas, ${A} picture, ${A} svg image,
${A} [style*="background-image"] { filter: ${REINVERT} !important; }
${A}[data-force-dark-reinvert-frames] iframe { filter: ${REINVERT} !important; }
`;

let keepAlive: ReturnType<typeof setInterval> | null = null;

function ensureStyle(doc: Document): void {
  let style = doc.getElementById(INVERT_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = INVERT_STYLE_ID;
    style.textContent = INVERT_CSS;
  }
  // Frameworks sometimes replace <head>; re-attach if we got dropped.
  if (!style.isConnected) (doc.head ?? doc.documentElement).appendChild(style);
}

export const invertStrategy: PageThemeStrategy & {
  setReinvertFrames(doc: Document, on: boolean): void;
} = {
  id: 'invert',

  apply(page: PageContext): StrategyResult {
    const doc = page.document;
    ensureStyle(doc);
    doc.documentElement.setAttribute(ROOT_SCHEME_ATTR, 'invert');
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = setInterval(() => ensureStyle(doc), 1000);
    return 'handled';
  },

  setReinvertFrames(doc: Document, on: boolean): void {
    if (on) doc.documentElement.setAttribute('data-force-dark-reinvert-frames', '');
    else doc.documentElement.removeAttribute('data-force-dark-reinvert-frames');
  },

  revert(page: PageContext): void {
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    page.document.getElementById(INVERT_STYLE_ID)?.remove();
    const root = page.document.documentElement;
    root.removeAttribute('data-force-dark-reinvert-frames');
    if (root.getAttribute(ROOT_SCHEME_ATTR) === 'invert') {
      root.removeAttribute(ROOT_SCHEME_ATTR);
    }
  },
};
