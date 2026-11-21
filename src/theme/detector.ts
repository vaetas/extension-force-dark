import { parseColor, srgbLightness } from './color';

const COLOR_SCHEME_META = 'meta[name="color-scheme"]';
const FRAMEWORK_ROOTS = ['#root', '#__next', 'app-root', '#app'];

export function hasDarkMarkers(doc: Document): boolean {
  const root = doc.documentElement;
  const body = doc.body;
  const darkClasses = ['dark', 'dark-mode', 'theme-dark', 'night', 'night-mode'];
  for (const name of darkClasses) {
    if (root.classList.contains(name) || body?.classList.contains(name)) {
      return true;
    }
  }

  const attrs = [
    'data-theme',
    'data-color-mode',
    'data-bs-theme',
    'data-mui-color-scheme',
  ];
  for (const attr of attrs) {
    const rootValue = root.getAttribute(attr)?.toLowerCase();
    const bodyValue = body?.getAttribute(attr)?.toLowerCase();
    if (rootValue === 'dark' || bodyValue === 'dark') return true;
  }

  return false;
}

export function hasStrictDarkColorScheme(doc: Document): boolean {
  // Only an author meta tag counts. The extension sets `color-scheme: dark`
  // on the root itself; treating that computed value as "already dark"
  // skipped recolor and left light pages unchanged.
  const meta = doc.querySelector(COLOR_SCHEME_META) as HTMLMetaElement | null;
  if (!meta) return false;
  const content = meta.content.toLowerCase().trim();
  return content === 'only dark';
}

function effectivePageBackgroundIsLight(doc: Document): boolean {
  // A light, opaque body/root background means the site is light-themed even
  // if individual sample points (dark headers, images) happen to be dark.
  for (const node of [doc.body, doc.documentElement]) {
    if (!node) continue;
    const bg = parseColor(getComputedStyle(node).backgroundColor);
    if (bg && bg.a > 0.9) {
      return srgbLightness(bg) > 0.45;
    }
  }
  return false;
}

/** Dark/light state of the page canvas, or null when it is transparent. */
function canvasIsDark(doc: Document): boolean | null {
  for (const node of [doc.documentElement, doc.body]) {
    if (!node) continue;
    const bg = parseColor(getComputedStyle(node).backgroundColor);
    if (bg && bg.a > 0.9) return srgbLightness(bg) <= 0.45;
  }
  // Nothing painted by the author: the browser canvas follows color-scheme.
  const scheme = doc.documentElement
    ? getComputedStyle(doc.documentElement).colorScheme
    : '';
  return /\bdark\b/.test(scheme) && !/\blight\b/.test(scheme) ? true : null;
}

const NON_SURFACE = /^(INPUT|TEXTAREA|SELECT|BUTTON|IMG|VIDEO|CANVAS|SVG|PICTURE)$/;

function samplePointIsDarkBackground(doc: Document, x: number, y: number): boolean | null {
  const el = doc.elementFromPoint(x, y) as HTMLElement | null;
  // Form controls and media get UA/own colors that say nothing about the page.
  if (!el || NON_SURFACE.test(el.tagName.toUpperCase())) return null;

  const bg = parseColor(getComputedStyle(el).backgroundColor);
  if (bg && bg.a > 0.2) {
    return srgbLightness(bg) <= 0.45;
  }

  // Walk up for an opaque background.
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const nodeBg = parseColor(getComputedStyle(node).backgroundColor);
    if (nodeBg && nodeBg.a > 0.5) {
      return srgbLightness(nodeBg) <= 0.45;
    }
    node = node.parentElement;
  }
  return null;
}

export type PageTone = 'dark' | 'light' | 'unknown';

export function classifyPage(doc: Document): PageTone {
  if (hasStrictDarkColorScheme(doc)) return 'dark';
  if (hasDarkMarkers(doc)) return 'dark';

  const win = doc.defaultView;
  if (!win) return 'unknown';

  // A light page canvas is decisive: sample points can hit dark headers or
  // images and must not make a light site look dark.
  if (effectivePageBackgroundIsLight(doc)) return 'light';

  const width = win.innerWidth || 800;
  const height = win.innerHeight || 600;
  const points = [
    [width * 0.5, height * 0.5],
    [width * 0.2, height * 0.2],
    [width * 0.8, height * 0.2],
    [width * 0.5, height * 0.8],
    [16, 16],
  ] as const;

  const canvas = canvasIsDark(doc);
  let darkVotes = 0;
  let samples = 0;
  for (const [x, y] of points) {
    // Points past the end of a short page hit <html>; the canvas decides there.
    const vote = samplePointIsDarkBackground(doc, x, y) ?? canvas;
    if (vote == null) continue;
    samples += 1;
    if (vote) darkVotes += 1;
  }

  if (samples === 0) return 'unknown';
  return darkVotes / samples >= 0.5 ? 'dark' : 'light';
}

export function samplePageIsDark(doc: Document): boolean {
  return classifyPage(doc) === 'dark';
}

export function hasFrameworkRoot(doc: Document): boolean {
  return FRAMEWORK_ROOTS.some((selector) => doc.querySelector(selector));
}

export function hasLargeMediaSurface(doc: Document): boolean {
  const win = doc.defaultView;
  if (!win) return false;
  const viewportArea = (win.innerWidth || 1) * (win.innerHeight || 1);
  const nodes = [
    ...Array.from(doc.querySelectorAll('canvas')),
    ...Array.from(doc.querySelectorAll('video')),
  ] as HTMLElement[];

  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > viewportArea * 0.4) return true;
  }
  return false;
}
