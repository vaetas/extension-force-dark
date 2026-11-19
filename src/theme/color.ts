import type { ColorRole, HSLA, RGBA } from './types';

const parseCache = new Map<string, RGBA | null>();
const modifyCache = new Map<string, string>();

let probeEl: HTMLElement | null = null;

function getProbe(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (!probeEl) {
    probeEl = document.createElement('div');
    probeEl.style.display = 'none';
  }
  return probeEl;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function srgbLightness(color: RGBA): number {
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
}

export function rgbaToHsla(color: RGBA): HSLA {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s, l, a: color.a };
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

export function hslaToRgba(color: HSLA): RGBA {
  const h = ((color.h % 360) + 360) % 360 / 360;
  const s = clamp(color.s, 0, 1);
  const l = clamp(color.l, 0, 1);
  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
    a: color.a,
  };
}

export function formatRgba(color: RGBA): string {
  const a = Math.round(color.a * 1000) / 1000;
  if (a >= 1) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${a})`;
}

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE =
  /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+%?))?\s*\)$/i;
const RGB_SPACE_RE =
  /^rgba?\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+%?))?\s*\)$/i;

function parseHex(value: string): RGBA | null {
  const match = HEX_RE.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (hex.length !== 6 && hex.length !== 8) return null;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function parseRgbChannels(value: string): RGBA | null {
  const match = RGB_RE.exec(value) ?? RGB_SPACE_RE.exec(value);
  if (!match) return null;
  const aRaw = match[4];
  let a = 1;
  if (aRaw != null) {
    a = aRaw.endsWith('%')
      ? Number.parseFloat(aRaw) / 100
      : Number.parseFloat(aRaw);
  }
  return {
    r: clamp(Math.round(Number.parseFloat(match[1])), 0, 255),
    g: clamp(Math.round(Number.parseFloat(match[2])), 0, 255),
    b: clamp(Math.round(Number.parseFloat(match[3])), 0, 255),
    a: clamp(a, 0, 1),
  };
}

/** Pure-string parser used in unit tests (no DOM). */
export function parseColorString(value: string): RGBA | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === 'transparent') {
    return trimmed === 'transparent' ? { r: 0, g: 0, b: 0, a: 0 } : null;
  }
  if (
    trimmed.startsWith('var(') ||
    trimmed === 'currentcolor' ||
    trimmed === 'inherit' ||
    trimmed === 'initial' ||
    trimmed === 'unset' ||
    trimmed === 'revert'
  ) {
    return null;
  }

  const fromHex = parseHex(trimmed);
  if (fromHex) return fromHex;

  const fromRgb = parseRgbChannels(trimmed);
  if (fromRgb) return fromRgb;

  // Named colors and modern color functions need the DOM probe.
  return null;
}

export function parseColor(value: string): RGBA | null {
  const key = value.trim().toLowerCase();
  if (parseCache.has(key)) {
    return parseCache.get(key) ?? null;
  }

  const fromString = parseColorString(value);
  if (fromString) {
    parseCache.set(key, fromString);
    return fromString;
  }

  if (
    key.startsWith('var(') ||
    key === 'currentcolor' ||
    key === 'inherit' ||
    key === 'initial' ||
    key === 'unset' ||
    key === 'revert' ||
    !key
  ) {
    parseCache.set(key, null);
    return null;
  }

  const probe = getProbe();
  if (!probe) {
    parseCache.set(key, null);
    return null;
  }

  try {
    probe.style.color = '';
    probe.style.color = value;
    const computed = probe.style.color;
    if (!computed) {
      parseCache.set(key, null);
      return null;
    }
    const parsed = parseRgbChannels(computed) ?? parseColorString(computed);
    parseCache.set(key, parsed);
    return parsed;
  } catch {
    parseCache.set(key, null);
    return null;
  }
}

function isNeutral(hsla: HSLA, forBackground: boolean): boolean {
  if (hsla.l < 0.2) return true;
  if (forBackground) return hsla.s < 0.12;
  return hsla.s < 0.24;
}

function modifyBlueFgHue(h: number): number {
  if (h >= 205 && h <= 245) {
    return 205 + ((h - 205) / 40) * 15;
  }
  return h;
}

export function modifyBackgroundColor(color: RGBA): RGBA {
  const hsla = rgbaToHsla(color);
  if (hsla.l <= 0.35) {
    return color;
  }

  if (isNeutral(hsla, true)) {
    return hslaToRgba({ h: 40, s: 0.08, l: 0.09, a: color.a });
  }

  const l = clamp(0.14 + (1 - hsla.l) * 0.2, 0.14, 0.34);
  const s = clamp(hsla.s * 0.7, 0, 0.55);
  let h = hsla.h;
  if (h >= 40 && h <= 70) {
    h = 35;
  }
  return hslaToRgba({ h, s, l, a: color.a });
}

export function modifyForegroundColor(color: RGBA): RGBA {
  const hsla = rgbaToHsla(color);
  if (hsla.l >= 0.65) {
    return color;
  }

  if (isNeutral(hsla, false)) {
    return hslaToRgba({ h: 40, s: 0.06, l: 0.88, a: color.a });
  }

  const l = clamp(Math.max(hsla.l, 0.62), 0.62, 0.92);
  const s = clamp(hsla.s, 0, 0.7);
  const h = modifyBlueFgHue(hsla.h);
  return hslaToRgba({ h, s, l, a: color.a });
}

export function modifyBorderColor(color: RGBA): RGBA {
  const hsla = rgbaToHsla(color);
  const l = clamp(0.24 + hsla.l * 0.16, 0.24, 0.4);
  const s = isNeutral(hsla, true) ? 0.05 : clamp(hsla.s * 0.5, 0, 0.4);
  const h = isNeutral(hsla, true) ? 40 : hsla.h;
  return hslaToRgba({ h, s, l, a: color.a });
}

export function modifyShadowColor(color: RGBA): RGBA {
  const hsla = rgbaToHsla(color);
  return hslaToRgba({
    h: hsla.h,
    s: clamp(hsla.s * 0.4, 0, 0.3),
    l: clamp(hsla.l * 0.25, 0, 0.18),
    a: clamp(Math.max(color.a, 0.35), 0, 0.85),
  });
}

export function relativeLuminance(color: RGBA): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function ensureContrast(
  foreground: RGBA,
  background: RGBA,
  minRatio = 4.5,
): RGBA {
  let fg = { ...foreground };
  if (contrastRatio(fg, background) >= minRatio) {
    return fg;
  }

  for (let l = 0.62; l <= 0.92; l += 0.02) {
    const candidate = hslaToRgba({
      ...rgbaToHsla(fg),
      l,
    });
    if (contrastRatio(candidate, background) >= minRatio) {
      return candidate;
    }
    fg = candidate;
  }

  return hslaToRgba({ h: 40, s: 0.06, l: 0.92, a: foreground.a });
}

export function modifyColor(color: RGBA, role: ColorRole): RGBA {
  switch (role) {
    case 'background':
      return modifyBackgroundColor(color);
    case 'foreground':
      return modifyForegroundColor(color);
    case 'border':
      return modifyBorderColor(color);
    case 'shadow':
      return modifyShadowColor(color);
    default:
      return color;
  }
}

export function modifyColorToString(color: RGBA, role: ColorRole): string {
  const key = `${role}:${color.r},${color.g},${color.b},${color.a}`;
  const cached = modifyCache.get(key);
  if (cached) return cached;
  const result = formatRgba(modifyColor(color, role));
  modifyCache.set(key, result);
  return result;
}

export function clearColorCaches(): void {
  parseCache.clear();
  modifyCache.clear();
}

export function roleForProperty(property: string): ColorRole | null {
  const prop = property.toLowerCase();
  if (prop.startsWith('--')) return null;
  if (prop.includes('shadow')) return 'shadow';
  if (
    prop.includes('border') ||
    prop.includes('outline') ||
    prop === 'scrollbar-color'
  ) {
    return 'border';
  }
  if (
    prop.includes('background') ||
    prop === 'background-color' ||
    prop === 'background'
  ) {
    return 'background';
  }
  if (
    prop === 'color' ||
    prop === 'caret-color' ||
    prop === 'fill' ||
    prop === 'stroke' ||
    prop === 'stop-color' ||
    prop === '-webkit-text-fill-color'
  ) {
    return 'foreground';
  }
  if (prop.includes('color')) {
    return 'foreground';
  }
  return null;
}

const COLOR_TOKEN_RE =
  /#(?:[0-9a-f]{3,8})\b|rgba?\([^)]+\)|hsla?\([^)]+\)|oklch\([^)]+\)|oklab\([^)]+\)|lab\([^)]+\)|lch\([^)]+\)|color\([^)]+\)|\b(?:transparent|currentcolor|inherit|black|white|red|blue|green|gray|grey|silver|maroon|purple|fuchsia|lime|olive|yellow|navy|teal|aqua|orange|aliceblue|antiquewhite|aquamarine|azure|beige|bisque|blanchedalmond|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|gainsboro|ghostwhite|gold|goldenrod|greenyellow|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|limegreen|linen|magenta|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|oldlace|olivedrab|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|thistle|tomato|turquoise|violet|wheat|whitesmoke|yellowgreen)\b/gi;

export function rewriteColorsInValue(
  value: string,
  role: ColorRole,
): string | null {
  if (!value || value.includes('var(')) {
    return null;
  }

  // Leave pure url(...) backgrounds untouched.
  if (/^url\(/i.test(value.trim()) && !/gradient/i.test(value)) {
    return null;
  }

  let changed = false;
  const rewritten = value.replace(COLOR_TOKEN_RE, (token) => {
    const lower = token.toLowerCase();
    if (
      lower === 'currentcolor' ||
      lower === 'inherit' ||
      lower === 'transparent'
    ) {
      return token;
    }
    const parsed = parseColor(token);
    if (!parsed) return token;
    changed = true;
    return modifyColorToString(parsed, role);
  });

  return changed ? rewritten : null;
}

export function isColorProperty(property: string): boolean {
  const prop = property.toLowerCase();
  if (prop.startsWith('--')) return true;
  return (
    prop === 'color' ||
    prop === 'background' ||
    prop === 'background-color' ||
    prop === 'background-image' ||
    prop === 'border-color' ||
    prop === 'border-top-color' ||
    prop === 'border-right-color' ||
    prop === 'border-bottom-color' ||
    prop === 'border-left-color' ||
    prop === 'outline-color' ||
    prop === 'box-shadow' ||
    prop === 'text-shadow' ||
    prop === 'fill' ||
    prop === 'stroke' ||
    prop === 'caret-color' ||
    prop === 'scrollbar-color' ||
    prop === 'stop-color' ||
    prop === '-webkit-text-fill-color' ||
    (prop.includes('color') && prop !== '-webkit-print-color-adjust')
  );
}
