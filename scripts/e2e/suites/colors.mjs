/* eslint-disable */
// Every colour syntax an author can write, delivered via stylesheet AND inline.
import { mode, sleep } from '../harness.mjs';
import { doc, dataPng } from './_util.mjs';

// Verified by dumping the override sheet: no rule is emitted for these values.
const NAMED = 'named colour: parseColor() reads probe.style.color, which Chrome leaves as the keyword, so it parses as null';
const MODERN = 'oklch/lab/lch/color(): probe.style.color keeps the original syntax, so parseColor() returns null (Tailwind v4 emits oklch everywhere)';
const MIX = 'color-mix()/relative colour: not matched by the colour tokenizer / not parseable';
const named = (list, reason) => Object.fromEntries(list.map((v) => [v, reason]));
const KNOWN_BG = {
  ...named(['white', 'whitesmoke', 'ghostwhite', 'snow', 'ivory', 'floralwhite'], NAMED),
  ...named(['oklch(98% 0 0)', 'oklab(0.98 0 0)', 'lab(98% 0 0)', 'lch(98% 0 0)', 'color(srgb 1 1 1)', 'color(display-p3 1 1 1)'], MODERN),
  ...named(['color-mix(in srgb, white 80%, #eee)', 'rgb(from #fff r g b)'], MIX),
};
const KNOWN_FG = {
  ...named(['black', 'darkslategray', 'dimgray'], NAMED),
  ...named(['oklch(20% 0 0)', 'lab(10% 0 0)', 'color(srgb 0.1 0.1 0.1)'], MODERN),
  ...named(['color-mix(in srgb, black 80%, #333)', 'rgb(from black r g b)'], MIX),
};
const KNOWN_GRADIENT = {
  'linear-gradient(oklch(98% 0 0), oklch(92% 0 0))': MODERN,
};

const BG = [
  '#fff', '#FFFFFF', '#ffffffff', '#fffa', 'white', 'whitesmoke', 'ghostwhite', 'snow', 'ivory', 'floralwhite',
  'rgb(255,255,255)', 'rgb(255 255 255)', 'rgb(255 255 255 / 80%)', 'rgba(255,255,255,0.9)',
  'hsl(0 0% 100%)', 'hsl(210deg 20% 98%)', 'hsla(0,0%,100%,.9)', 'hwb(0 100% 0%)',
  'oklch(98% 0 0)', 'oklab(0.98 0 0)', 'lab(98% 0 0)', 'lch(98% 0 0)',
  'color(srgb 1 1 1)', 'color(display-p3 1 1 1)',
  'color-mix(in srgb, white 80%, #eee)', 'color-mix(in oklab, #fff 50%, transparent)',
  'light-dark(#fff, #fff)', 'rgb(from #fff r g b)',
  'Canvas', 'Field', 'Window', 'Menu',
  '#f8f9fa', '#fafafa', '#f5f5f5', '#eee', '#e9ecef', '#ddd',
  '#fff url(data:image/gif;base64,R0lGODlhAQABAAAAACw=) no-repeat',
];
const FG = [
  '#000', '#111', '#222', '#333', '#444', 'black', 'rgb(0 0 0)', 'rgb(0,0,0,.87)', 'hsl(0 0% 10%)',
  'oklch(20% 0 0)', 'lab(10% 0 0)', 'color(srgb 0.1 0.1 0.1)', 'darkslategray', 'dimgray',
  'color-mix(in srgb, black 80%, #333)', 'CanvasText', 'WindowText', 'rgb(from black r g b)',
];
const GRADIENTS = [
  'linear-gradient(#fff, #f0f0f0)',
  'linear-gradient(to right, #ffffff 0%, #eeeeee 100%)',
  'radial-gradient(circle, #fff, #eee)',
  'conic-gradient(#fff, #eee, #fff)',
  'repeating-linear-gradient(#fff 0 10px, #eee 10px 20px)',
  'linear-gradient(rgba(255,255,255,.95), rgba(255,255,255,.95)), url(DATA)',
  'linear-gradient(180deg, hsl(0 0% 100%), hsl(0 0% 94%))',
  'linear-gradient(oklch(98% 0 0), oklch(92% 0 0))',
];

export default function register({ scenario, server }) {
  const RECOLOR = mode('recolor');

  const bgRules = BG.map((v, i) => `#b${i} { background: ${v}; ${/url/.test(v) ? '' : ''} }`).join('\n');
  const bgPage = doc(
    BG.map((_, i) => `<div class="t" id="b${i}">r</div><div class="t" id="ib${i}" style="background:${BG[i].replace(/"/g, "'")}">i</div>`).join(''),
    { style: `.t { padding: 4px; color: #111 } ${bgRules}` },
  );
  server.add('/colors/bg.html', bgPage);

  scenario('colour syntaxes: backgrounds (stylesheet + inline)', async (t) => {
    const page = await t.open('/colors/bg.html', { settings: RECOLOR });
    await t.lib(page);
    const res = await page.evaluate((n) => {
      const out = [];
      for (let i = 0; i < n; i += 1) {
        out.push({ rule: __t.bgLuma('#b' + i), inline: __t.bgLuma('#ib' + i) });
      }
      return out;
    }, BG.length);
    BG.forEach((v, i) => {
      const { rule, inline } = res[i];
      const label = `background: ${v.length > 48 ? v.slice(0, 45) + '…' : v}`;
      const ok = rule < 0.3 && inline < 0.3;
      const detail = `stylesheet ${rule.toFixed(2)}, inline ${inline.toFixed(2)}`;
      if (KNOWN_BG[v]) t.known(label, ok, KNOWN_BG[v], detail);
      else t.check(label, ok, detail);
    });
  });

  const fgPage = doc(
    FG.map((v, i) => `<p class="t" id="f${i}">rule text</p><p class="t" id="if${i}" style="color:${v}">inline text</p>`).join(''),
    { style: `.t { margin: 2px } ${FG.map((v, i) => `#f${i} { color: ${v} }`).join('\n')}` },
  );
  server.add('/colors/fg.html', fgPage);
  scenario('colour syntaxes: text colours get lightened (stylesheet + inline)', async (t) => {
    const page = await t.open('/colors/fg.html', { settings: RECOLOR });
    await t.lib(page);
    const res = await page.evaluate((n) => {
      const out = [];
      for (let i = 0; i < n; i += 1) out.push({ rule: __t.fgLuma('#f' + i), inline: __t.fgLuma('#if' + i) });
      return out;
    }, FG.length);
    FG.forEach((v, i) => {
      const { rule, inline } = res[i];
      const ok = rule > 0.55 && inline > 0.55;
      const label = `color: ${v}`;
      const detail = `stylesheet ${rule.toFixed(2)}, inline ${inline.toFixed(2)}`;
      if (KNOWN_FG[v]) t.known(label, ok, KNOWN_FG[v], detail);
      else t.check(label, ok, detail);
    });
  });

  const dataUri = dataPng('white', 8);
  const gradPage = doc(
    GRADIENTS.map((g, i) => `<div class="g" id="g${i}"></div>`).join(''),
    {
      style: `body { margin: 0 } .g { height: 40px; width: 600px } ${GRADIENTS.map((g, i) => `#g${i} { background: ${g.replace('DATA', dataUri)} }`).join('\n')}`,
    },
  );
  server.add('/colors/gradients.html', gradPage);
  scenario('colour syntaxes: gradients render dark (pixel check)', async (t) => {
    const page = await t.open('/colors/gradients.html', { settings: RECOLOR, viewport: { width: 700, height: 400 } });
    const points = GRADIENTS.map((_, i) => [60, 20 + i * 40]).concat(GRADIENTS.map((_, i) => [300, 20 + i * 40]));
    const shot = await t.shot(page, 'gradients', { points });
    GRADIENTS.forEach((g, i) => {
      const a = shot.at[i].luma;
      const b = shot.at[GRADIENTS.length + i].luma;
      const ok = a < 0.35 && b < 0.35;
      const detail = `left ${a.toFixed(2)}, middle ${b.toFixed(2)}`;
      if (KNOWN_GRADIENT[g]) t.known(g, ok, KNOWN_GRADIENT[g], detail);
      else t.check(g, ok, detail);
    });
  });

  // ---- hue preservation: brand / status colours must not turn grey ----------------
  const BRAND = [
    ['red', '#d32f2f', (c) => c.r > c.g + 30 && c.r > c.b + 30],
    ['green', '#198754', (c) => c.g > c.r + 20 && c.g > c.b + 10],
    ['blue', '#0d6efd', (c) => c.b > c.r + 40],
    ['amber', '#ffc107', (c) => c.r > c.b + 40],
    ['purple', '#6f42c1', (c) => c.b > c.g + 20 && c.r > c.g],
  ];
  server.add(
    '/colors/brand.html',
    doc(
      BRAND.map(([n, v]) => `<button class="btn" id="${n}">${n}</button><span class="txt" id="t-${n}" style="color:${v}">${n}</span>`).join(''),
      {
        style: `.btn { color: #fff; border: 0; padding: 8px 14px } ${BRAND.map(([n, v]) => `#${n} { background: ${v} }`).join(' ')}`,
      },
    ),
  );
  scenario('brand colours keep their hue (not greyed out) and stay legible', async (t) => {
    const page = await t.open('/colors/brand.html', { settings: RECOLOR });
    await t.lib(page);
    for (const [name, , hueOk] of BRAND) {
      const rgb = await page.evaluate((n) => {
        const [r, g, b] = __t.bgRgb('#' + n);
        return { r, g, b };
      }, name);
      t.check(`${name} button keeps its hue`, hueOk(rgb), JSON.stringify(rgb));
      const ratio = await t.call(page, 'contrastOf', '#' + name);
      t.check(`${name} button label is legible`, ratio >= 3, `contrast ${ratio.toFixed(1)}`);
      const textRatio = await t.call(page, 'contrastOf', '#t-' + name);
      t.check(`${name} coloured text is legible on dark`, textRatio >= 3, `contrast ${textRatio.toFixed(1)}`);
    }
  });

  // ---- borders / shadows / outlines ---------------------------------------------------
  server.add(
    '/colors/decor.html',
    doc(`<div class="d" id="border-long">border-color</div><div class="d" id="border-collapsed">longhands in one rule</div><div class="d" id="border">border</div><div class="d" id="border-bottom">border-bottom</div><div class="d" id="shadow">box-shadow</div><div class="d" id="outline-long">outline-color</div><div class="d" id="outline">outline</div><div class="d" id="tshadow">text-shadow</div><div class="d" id="deco">text-decoration</div>`, {
      style: `
      .d { margin: 12px; padding: 10px; color: #111 }
      .d { border-style: solid; border-width: 2px; outline-style: solid; outline-width: 2px }
      #border-long { border-color: #ddd }
      #border-collapsed { border-width: 2px; border-style: solid; border-color: #ddd }
      #border { border: 2px solid #ddd }
      #border-bottom { border-bottom: 1px solid #ddd }
      #shadow { box-shadow: 0 0 0 2px #e5e5e5 }
      #outline-long { outline-color: #ccc }
      #outline { outline: 2px solid #ccc }

      #tshadow { text-shadow: 0 1px 0 #fff }
      #deco { text-decoration: underline #fff }
      `,
    }),
  );
  scenario('borders, shadows, outlines and text-shadows are darkened', async (t) => {
    const page = await t.open('/colors/decor.html', { settings: RECOLOR });
    await t.lib(page);
    const r = await page.evaluate(() => {
      const css = (id, prop) => getComputedStyle(document.getElementById(id))[prop];
      const first = (value) => {
        const m = /rgba?\([^)]*\)/.exec(value);
        return m ? __t.lum(m[0]) : 1;
      };
      return {
        borderLong: first(css('border-long', 'borderTopColor')),
        borderCollapsed: first(css('border-collapsed', 'borderTopColor')),
        border: first(css('border', 'borderTopColor')),
        borderBottom: first(css('border-bottom', 'borderBottomColor')),
        shadow: first(css('shadow', 'boxShadow')),
        outlineLong: first(css('outline-long', 'outlineColor')),
        outline: first(css('outline', 'outlineColor')),
        tshadow: first(css('tshadow', 'textShadow')),
        deco: first(css('deco', 'textDecorationColor')),
      };
    });
    const SHORTHAND = 'shorthand: isColorProperty() only accepts longhands (border-color, outline-color…), so `border:`/`outline:`/`text-decoration:` values are never rewritten';
    t.check('border-color in its own rule (Tailwind style) is darkened', r.borderLong < 0.5, JSON.stringify(r));
    t.check('border-width/style/color longhands in one rule are darkened', r.borderCollapsed < 0.5, r.borderCollapsed.toFixed(2));
    t.check('box-shadow ring is darkened', r.shadow < 0.5, JSON.stringify(r));
    t.check('text-shadow highlight is no longer white', r.tshadow < 0.5, JSON.stringify(r));
    t.check('outline-color in its own rule is darkened', r.outlineLong < 0.5, JSON.stringify(r));
    t.known('`border: 2px solid #ddd` shorthand is darkened', r.border < 0.5, SHORTHAND, r.border.toFixed(2));
    t.known('`border-bottom: 1px solid #ddd` shorthand is darkened', r.borderBottom < 0.5, SHORTHAND, r.borderBottom.toFixed(2));
    t.known('`outline: 2px solid #ccc` shorthand is darkened', r.outline < 0.5, SHORTHAND, r.outline.toFixed(2));
    t.known('`text-decoration: underline #fff` is darkened', r.deco < 0.5, SHORTHAND, r.deco.toFixed(2));
  });
}
