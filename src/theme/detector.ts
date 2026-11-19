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
  const meta = doc.querySelector(COLOR_SCHEME_META) as HTMLMetaElement | null;
  if (meta) {
    const content = meta.content.toLowerCase().trim();
    if (content === 'dark' || content === 'only dark') return true;
    if (content === 'light' || content === 'only light') return false;
  }

  const scheme = getComputedStyle(doc.documentElement)
    .getPropertyValue('color-scheme')
    .trim()
    .toLowerCase();
  return scheme === 'dark' || scheme === 'only dark';
}

function samplePoint(
  doc: Document,
  x: number,
  y: number,
): { bgDark: boolean; textLight: boolean } | null {
  const el = doc.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return null;
  const style = getComputedStyle(el);
  const bg = parseColor(style.backgroundColor);
  const fg = parseColor(style.color);

  let bgDark = false;
  let textLight = false;

  if (bg && bg.a > 0.2) {
    bgDark = srgbLightness(bg) <= 0.45;
  } else {
    // Walk up for an opaque background.
    let node: HTMLElement | null = el;
    while (node) {
      const nodeBg = parseColor(getComputedStyle(node).backgroundColor);
      if (nodeBg && nodeBg.a > 0.5) {
        bgDark = srgbLightness(nodeBg) <= 0.45;
        break;
      }
      node = node.parentElement;
    }
  }

  if (fg) {
    textLight = srgbLightness(fg) >= 0.55;
  }

  return { bgDark, textLight };
}

export function samplePageIsDark(doc: Document): boolean {
  if (hasStrictDarkColorScheme(doc)) return true;
  if (hasDarkMarkers(doc)) return true;

  const win = doc.defaultView;
  if (!win) return false;

  const width = win.innerWidth || 800;
  const height = win.innerHeight || 600;
  const points = [
    [width * 0.5, height * 0.5],
    [width * 0.2, height * 0.2],
    [width * 0.8, height * 0.2],
    [width * 0.5, height * 0.8],
    [16, 16],
  ] as const;

  let darkVotes = 0;
  let samples = 0;

  const bodyStyle = doc.body ? getComputedStyle(doc.body) : null;
  const rootStyle = getComputedStyle(doc.documentElement);
  const rootBg = parseColor(
    bodyStyle?.backgroundColor || rootStyle.backgroundColor,
  );
  if (rootBg && rootBg.a > 0.5) {
    samples += 1;
    if (srgbLightness(rootBg) <= 0.45) darkVotes += 1;
  }

  for (const [x, y] of points) {
    const sample = samplePoint(doc, x, y);
    if (!sample) continue;
    samples += 1;
    if (sample.bgDark || sample.textLight) darkVotes += 1;
  }

  if (samples === 0) return false;
  return darkVotes / samples >= 0.5;
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
