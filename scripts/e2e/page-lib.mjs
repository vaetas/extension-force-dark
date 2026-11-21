/* eslint-disable */
// Helpers that run INSIDE the page (main world). Installed on demand as
// `window.__t` by harness.call(); everything must be self-contained.
function install() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });

  /** Any CSS color string -> [r, g, b, a]. Canvas understands every syntax the browser does. */
  const rgba = (css) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#000';
    cx.fillStyle = css;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const lum = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const rel = ([r, g, b]) => {
    const f = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const [hi, lo] = [rel(a), rel(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const over = (top, bottom) => {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat([1]);
  };

  /** What the browser paints behind everything. */
  const pageCanvas = () => {
    const root = document.documentElement;
    for (const el of [root, document.body]) {
      if (!el) continue;
      const c = rgba(getComputedStyle(el).backgroundColor);
      if (c[3] > 0.99) return c;
      if (c[3] > 0) return over(c, [255, 255, 255, 1]);
    }
    return /\bdark\b/.test(getComputedStyle(root).colorScheme) ? [18, 18, 18, 1] : [255, 255, 255, 1];
  };

  /** Effective background colour behind an element; `image` when an image/gradient is involved. */
  const bgOf = (el) => {
    const layers = [];
    let image = false;
    let node = el;
    let opaque = false;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      const c = rgba(cs.backgroundColor);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') image = true;
      if (c[3] > 0) layers.push(c);
      if (c[3] > 0.99) {
        opaque = true;
        break;
      }
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    }
    let out = opaque ? layers.pop() : pageCanvas();
    for (let i = layers.length - 1; i >= 0; i -= 1) out = over(layers[i], out);
    return { rgb: out, image };
  };

  const q = (sel) => (typeof sel === 'string' ? document.querySelector(sel) : sel);

  const shadowRoots = (root) => {
    const found = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        found.push(el.shadowRoot);
        found.push(...shadowRoots(el.shadowRoot));
      }
    }
    return found;
  };

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION', 'TITLE', 'HEAD']);

  window.__t = {
    rgba,
    lum: (css) => lum(rgba(css)),
    bgLuma: (sel) => lum(bgOf(q(sel)).rgb),
    bgRgb: (sel) => bgOf(q(sel)).rgb.slice(0, 3).map(Math.round),
    fgLuma: (sel) => lum(rgba(getComputedStyle(q(sel)).color)),
    cssLuma: (sel, prop) => lum(rgba(getComputedStyle(q(sel))[prop])),
    pageCanvasLuma: () => lum(pageCanvas()),
    contrastOf: (sel) => {
      const el = q(sel);
      const fg = rgba(getComputedStyle(el).color);
      const bg = bgOf(el).rgb;
      return contrast(over(fg, bg), bg);
    },
    rect: (sel) => {
      const r = q(sel).getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    },

    /**
     * Contrast audit of visible text. Text over images/gradients is reported
     * separately because its real background is unknowable from the DOM.
     */
    textScan: ({ min = 3, viewportOnly = true, root = null } = {}) => {
      const roots = [root ? q(root) : document.body, ...(root ? [] : shadowRoots(document))];
      let chars = 0;
      let low = 0;
      let overImage = 0;
      const offenders = [];
      for (const r of roots) {
        if (!r) continue;
        const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent.trim();
          if (!text) continue;
          const el = n.parentElement;
          if (!el || SKIP_TAGS.has(el.tagName)) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
          if (parseFloat(cs.fontSize) === 0) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const rect = range.getClientRects()[0];
          if (!rect || rect.width === 0 || rect.height === 0) continue;
          if (viewportOnly && (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth)) continue;
          const fillColor = cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color;
          const fg = rgba(fillColor);
          if (fg[3] === 0) continue;
          const bg = bgOf(el);
          if (bg.image) {
            overImage += text.length;
            continue;
          }
          chars += text.length;
          const ratio = contrast(over(fg, bg.rgb), bg.rgb);
          if (ratio < min) {
            low += text.length;
            offenders.push({
              text: text.slice(0, 40),
              ratio: Math.round(ratio * 10) / 10,
              fg: fillColor,
              bg: bg.rgb.map(Math.round).join(','),
              el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : ''),
              n: text.length,
            });
          }
        }
      }
      offenders.sort((a, b) => b.n - a.n);
      return { chars, low, lowFrac: chars ? low / chars : 0, overImage, offenders: offenders.slice(0, 6) };
    },

    /** Visible borders that are still near-white (glare lines on a dark page). */
    lightBorders: (threshold = 0.7) => {
      const out = [];
      for (const el of document.body.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          if (cs['border' + side + 'Style'] === 'none' || parseFloat(cs['border' + side + 'Width']) === 0) continue;
          const c = rgba(cs['border' + side + 'Color']);
          if (c[3] > 0.3 && lum(c) > threshold) {
            out.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : '') + ':' + side.toLowerCase());
            break;
          }
        }
      }
      return out;
    },

    /** Structural fingerprint used to prove that turning a mode off restores the page. */
    fingerprint: () => {
      const walk = (el) => {
        const attrs = [...el.attributes]
          .filter((a) => !(a.name === 'style' && el.style.cssText === '') && a.name !== 'data-force-dark-scheme-ready')
          .map((a) => `${a.name}=${a.name === 'style' ? el.style.cssText : a.value}`)
          .sort()
          .join(' ');
        const kids = [...el.childNodes]
          .map((c) => (c.nodeType === 1 ? walk(c) : c.nodeType === 3 ? c.textContent : ''))
          .join('');
        return `<${el.tagName} ${attrs}>${kids}</${el.tagName}>`;
      };
      return walk(document.documentElement);
    },

    /** Everything the extension may have left behind in the document. */
    leftovers: () => {
      const out = [];
      for (const el of document.querySelectorAll('[id^="force-dark"]')) out.push(`#${el.id}`);
      // `-scheme-ready` is the MAIN-world script's handshake flag; it is meant to stay once injected.
      const attrs = (el) => [...el.attributes]
        .filter((a) => a.name.startsWith('data-force-dark') && a.name !== 'data-force-dark-scheme-ready')
        .map((a) => `${el.tagName.toLowerCase()}[${a.name}]`);
      for (const el of document.querySelectorAll('*')) out.push(...attrs(el));
      if (document.adoptedStyleSheets.length) out.push(`adoptedStyleSheets:${document.adoptedStyleSheets.length}`);
      for (const sr of shadowRoots(document)) if (sr.adoptedStyleSheets.length) out.push(`shadow adopted:${sr.adoptedStyleSheets.length}`);
      const root = getComputedStyle(document.documentElement);
      if (root.filter !== 'none') out.push(`filter:${root.filter}`);
      if (document.documentElement.style.colorScheme) out.push(`inline color-scheme:${document.documentElement.style.colorScheme}`);
      return out;
    },
  };
}

export const LIB_SOURCE = `(${install.toString()})()`;
