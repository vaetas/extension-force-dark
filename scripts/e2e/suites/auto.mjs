/* eslint-disable */
// Auto mode: prefer the site's own dark theme, else recolor, else invert.
import { mode, OFF, sleep } from '../harness.mjs';
import { doc, dataPng, pngBuffer, expectDark } from './_util.mjs';

export default function register({ scenario, server }) {
  const AUTO = mode('auto');
  const info = (page) =>
    page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-force-dark'),
      filter: getComputedStyle(document.documentElement).filter,
      theme: document.documentElement.getAttribute('data-bs-theme') ?? document.documentElement.getAttribute('data-theme'),
    }));

  // ---- the site ships its own dark theme, discovered in different ways ------------------
  server.add('/auto/media.html', doc('<h1>Own dark theme</h1><div id="card" class="card">card</div>', {
    style: `body{background:#fff;color:#111}.card{background:#f1f1f1;padding:10px}
            @media (prefers-color-scheme: dark){body{background:#101214;color:#eee}.card{background:#1d2023}}`,
  }));
  scenario('site with @media (prefers-color-scheme: dark): Auto uses it, Off gives it back', async (t) => {
    const page = await t.open('/auto/media.html', { settings: AUTO });
    t.check('status is "native"', (await t.status(page)) === 'native');
    t.check('page uses its own dark rules (exact #101214)', (await t.bgRgb?.(page)) === undefined && (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(16, 18, 20)');
    t.check('no recolor artifacts on a native page', (await t.call(page, 'leftovers')).every((x) => !/adopted|filter|force-dark-(invert|overrides)/.test(x)), (await t.call(page, 'leftovers')).join(','));
    await t.live(page, OFF, ['off']);
    t.check('Off restores the site light theme', (await t.bgLuma(page, 'body')) > 0.9);
    await t.live(page, AUTO, ['native', 'recolor']);
    t.check('Auto again → dark', (await t.bgLuma(page, 'body')) < 0.15);
  });

  scenario('OS already dark: Off leaves the page untouched, Auto keeps its own theme', async (t) => {
    const off = await t.open('/auto/media.html', { settings: OFF, scheme: 'dark' });
    t.check('Off: site is dark by itself and the extension adds nothing', (await t.bgLuma(off, 'body')) < 0.15 && (await t.call(off, 'leftovers')).length === 0);
    const on = await t.open('/auto/media.html', { settings: AUTO, scheme: 'dark' });
    t.check('Auto: native', (await t.status(on)) === 'native');
    t.check('Auto: still its own #101214', (await on.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(16, 18, 20)');
  });

  server.add('/css/auto-light.css', 'body{background:#fff;color:#111}', { type: 'text/css' });
  server.add('/css/auto-dark.css', 'body{background:#0e1114;color:#eee}', { type: 'text/css' });
  server.add('/auto/link-pair.html', doc('<h1>Two sheets</h1>', {
    head: `<link rel="stylesheet" href="/css/auto-light.css" media="(prefers-color-scheme: light)">
           <link rel="stylesheet" href="/css/auto-dark.css" media="(prefers-color-scheme: dark)">`,
  }));
  scenario('light/dark <link media="(prefers-color-scheme)"> pair', async (t) => {
    const page = await t.open('/auto/link-pair.html', { settings: AUTO });
    t.check('dark sheet selected → native', (await t.status(page)) === 'native');
    t.check('body is the dark sheet colour', (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(14, 17, 20)');
    await t.live(page, OFF, ['off']);
    t.check('Off restores the light sheet (media attributes put back)', (await t.bgLuma(page, 'body')) > 0.9);
    const media = await page.$$eval('link', (ls) => ls.map((l) => l.getAttribute('media')));
    t.check('link media attributes restored verbatim', media.join('|') === '(prefers-color-scheme: light)|(prefers-color-scheme: dark)', media.join('|'));
  });

  server.add('/auto/light.png', pngBuffer('white'), { type: 'image/png' });
  server.add('/auto/dark.png', pngBuffer('black'), { type: 'image/png' });
  server.add('/auto/picture.html', doc(`<picture><source media="(prefers-color-scheme: dark)" srcset="/auto/dark.png"><img id="logo" src="/auto/light.png" width="40" height="40"></picture>`));
  scenario('<picture><source media="(prefers-color-scheme: dark)"> picks the dark logo', async (t) => {
    const page = await t.open('/auto/picture.html', { settings: AUTO });
    await sleep(400);
    const src = () => page.$eval('#logo', (i) => i.currentSrc);
    t.check('dark source selected', /dark\.png$/.test(await src()), await src());
    await t.live(page, OFF, ['off']);
    await sleep(300);
    t.check('light source back when Off', /light\.png$/.test(await src()), await src());
  });

  // ---- JS-driven themes ---------------------------------------------------------------------
  server.add('/auto/js-theme.html', doc('<h1>JS theme</h1><div id="card" class="card">card</div>', {
    style: `body{background:#fff;color:#111}.card{background:#f1f1f1;padding:10px}
            [data-bs-theme=dark] body{background:#212529;color:#f8f9fa}[data-bs-theme=dark] .card{background:#2b3035}`,
    head: `<script>
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const apply = () => document.documentElement.setAttribute('data-bs-theme', mq.matches ? 'dark' : 'light');
      apply(); mq.addEventListener('change', apply);
    </script>`,
  }));
  scenario('JS reads matchMedia at startup (Bootstrap colour-modes pattern)', async (t) => {
    const page = await t.open('/auto/js-theme.html', { settings: AUTO });
    t.check('Auto on a fresh load: site flips itself to dark → native', (await t.status(page)) === 'native', String(await t.status(page)));
    t.check('data-bs-theme=dark', (await info(page)).theme === 'dark');
  });
  scenario('JS theme listening for "change": live switching', async (t) => {
    const page = await t.open('/auto/js-theme.html', { settings: OFF });
    t.check('starts light', (await info(page)).theme === 'light');
    await t.live(page, AUTO, ['native', 'recolor', 'invert']);
    const status = await t.status(page);
    t.known('live Off→Auto: the site is told (change event) and uses its own theme', status === 'native',
      'flipping data-force-dark-scheme does not dispatch MediaQueryList "change" events, so listeners never run', `status ${status}, theme ${(await info(page)).theme}`);
  });
  scenario('JS theme that flipped itself at load stays dark after Auto → Off (no reload)', async (t) => {
    const page = await t.open('/auto/js-theme.html', { settings: AUTO });
    t.check('precondition: site switched itself to dark', (await info(page)).theme === 'dark');
    await t.live(page, OFF, ['off']);
    await sleep(600);
    const theme = (await info(page)).theme;
    t.known('live Auto→Off: the site is told and returns to light', theme === 'light',
      'no "change" event when the forced value reverts, so the page JS never re-reads matchMedia', `theme ${theme}`);
  });

  server.add('/auto/light-dark.html', doc('<h1>light-dark()</h1>', {
    style: `:root{color-scheme:light dark}body{background:light-dark(#fff,#0f0f10);color:light-dark(#111,#eee)}`,
  }));
  scenario('color-scheme: light dark + light-dark()', async (t) => {
    const page = await t.open('/auto/light-dark.html', { settings: AUTO });
    t.check('native via the forced color-scheme', (await t.status(page)) === 'native');
    t.check('body is the dark branch', (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(15, 15, 16)');
    await t.live(page, OFF, ['off']);
    t.check('Off → light branch', (await t.bgLuma(page, 'body')) > 0.9);
  });

  // ---- sites that are dark already ------------------------------------------------------------
  server.add('/auto/always-dark.html', doc('<h1>Dark only</h1><div id="card" class="card">card</div><a href="#" id="a">link</a>', {
    style: `body{background:#111;color:#e6e6e6}.card{background:#1c1c1c;border:1px solid #333;padding:10px}a{color:#8ab4f8}`,
  }));
  scenario('a site that is dark by design is left alone in Auto', async (t) => {
    const page = await t.open('/auto/always-dark.html', { settings: AUTO });
    t.check('status native (nothing to do)', (await t.status(page)) === 'native', String(await t.status(page)));
    const s = await info(page);
    t.check('no inversion filter', s.filter === 'none', s.filter);
    t.check('colours unchanged (#111)', (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(17, 17, 17)');
  });
  scenario('Recolor on a dark-by-design site keeps it dark and legible', async (t) => {
    const page = await t.open('/auto/always-dark.html', { settings: mode('recolor') });
    await expectDark(t, page, 'body', 'body', 0.15);
    await expectDark(t, page, '#card', 'card', 0.2);
    const c = await t.call(page, 'contrastOf', '#card');
    t.check('body text contrast stays high', c >= 7, `contrast ${c.toFixed(1)}`);
    const lb = await t.call(page, 'lightBorders', 0.7);
    t.check('no glaring borders introduced', lb.length === 0, lb.join(','));
  });

  server.add('/auto/dark-marker-light.html', doc('<h1>class="dark" but light</h1><p id="p">still white</p>', {
    attrs: 'class="dark"', style: `body{background:#fff;color:#111}`,
  }));
  scenario('false positive: <html class="dark"> on a page that is actually light', async (t) => {
    const page = await t.open('/auto/dark-marker-light.html', { settings: AUTO });
    await sleep(800);
    const dark = (await t.bgLuma(page, 'body')) < 0.3 || /invert/.test((await info(page)).filter);
    t.known('page ends up dark', dark,
      'hasDarkMarkers() trusts class="dark" / data-theme="dark" without checking what is actually painted', `status ${await t.status(page)}`);
  });

  // ---- recolor fails → safety net -------------------------------------------------------------
  server.add('/auto/img-red.png', pngBuffer('red', 24), { type: 'image/png' });
  server.add('/auto/hard-light.html', doc('<h1>Hard to recolor</h1><p>Body text</p><img id="red" src="/auto/img-red.png" width="60" height="60">', {
    style: `@layer base{html,body{background:#fff !important;color:#111 !important}}`,
  }));
  scenario('Auto falls back to Invert when recolor cannot win, and keeps images natural', async (t) => {
    const page = await t.open('/auto/hard-light.html', { settings: AUTO, extra: 600 });
    t.check('status "invert"', (await t.waitStatus(page, 'invert', 12000)) === 'invert', String(await t.status(page)));
    await sleep(500);
    const r = await t.rect(page, '#red');
    const shot = await t.shot(page, 'auto-invert-fallback', { points: [[500, 500], [r.x + 30, r.y + 30]] });
    t.check('page background is dark', shot.at[0].luma < 0.3, shot.at[0].luma.toFixed(2));
    const px = shot.at[1];
    t.check('red image is still red (re-inverted)', px.r > px.g + 80 && px.r > px.b + 80, `${px.r},${px.g},${px.b}`);
    const left = await page.evaluate(() => document.adoptedStyleSheets.length);
    t.check('recolor was reverted before inverting (no stacked sheets)', left === 0, `adopted ${left}`);
  });

  // ---- shadow DOM sites ----------------------------------------------------------------------------
  server.add('/auto/shadow-media.html', doc('<x-app id="app"></x-app>', {
    style: `body{background:#fff;color:#111}`,
    head: `<script>
      customElements.define('x-app', class extends HTMLElement {
        connectedCallback() {
          const sr = this.attachShadow({ mode: 'open' });
          const s = new CSSStyleSheet();
          s.replaceSync(':host{display:block;background:#fff;color:#111;padding:20px}@media (prefers-color-scheme: dark){:host{background:#15181c;color:#eee}}');
          sr.adoptedStyleSheets = [s];
          sr.innerHTML = '<p>web component</p>';
        }
      });
    </script>`,
  }));
  scenario('web component whose only dark rules live in its shadow root', async (t) => {
    const page = await t.open('/auto/shadow-media.html', { settings: AUTO });
    await sleep(800);
    const dark = await page.evaluate(() => {
      const host = document.getElementById('app');
      return __t_lum(getComputedStyle(host).backgroundColor);
      function __t_lum(c) { const m = c.match(/\d+/g).map(Number); return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255; }
    });
    t.check('component ends up dark (by any route)', dark < 0.3, dark.toFixed(2));
    const status = await t.status(page);
    t.known('component is shown through its own dark theme (status native)', status === 'native',
      'the MAIN-world script only rewrites @media in document.styleSheets, not in shadow roots', `status ${status}`);
  });
}
