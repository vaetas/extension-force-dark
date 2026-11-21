/* eslint-disable */
// Iframes: follow the tab's host, nesting, opaque/blocked frames, invert interplay.
import { mode, OFF, sleep } from '../harness.mjs';
import { doc, pngBuffer } from './_util.mjs';

const MAIN = 'main.localhost';
export default function register({ scenario, server }) {
  const U = (path, host) => server.url(path, host);
  const framePage = doc('<h1>frame</h1><div id="card" class="card">in frame</div>', { style: 'body{background:#fff;color:#111;margin:0}.card{background:#eee;padding:10px}' });
  server.add('/fr/light.html', framePage);
  server.add('/fr/nest.html', doc(`<h2>level 1</h2><iframe id="deep" src="${U('/fr/light.html', 'deep.localhost')}" style="width:280px;height:120px"></iframe>`, { style: 'body{background:#fff}' }));
  server.add('/fr/top.html', doc(`<h1>top</h1><div id="card" class="card">top</div>
    <iframe id="child" src="${U('/fr/light.html', 'child.localhost')}"></iframe>
    <iframe id="nest" src="${U('/fr/nest.html', 'child.localhost')}"></iframe>
    <iframe id="sand" sandbox="allow-scripts" src="${U('/fr/light.html?sand', 'child.localhost')}"></iframe>
    <iframe id="blocked" src="${U('/fr/light.html?blocked', 'www.recaptcha.localhost')}"></iframe>
    <iframe id="srcdoc" srcdoc="<style>body{background:#fff;margin:0}</style><p id='card'>srcdoc</p>"></iframe>`, {
    style: 'body{background:#fff;color:#111}.card{background:#f4f4f4;padding:10px}iframe{width:300px;height:130px;border:1px solid #ccc;margin:4px}',
  }));

  const frameBy = (page, pred) => page.frames().find((f) => f !== page.mainFrame() && pred(f.url()));
  const frameLuma = async (t, page, pred) => {
    const f = frameBy(page, pred);
    if (!f) return null;
    await t.lib(f);
    return f.evaluate(() => window.__t.bgLuma('#card'));
  };

  scenario('recolor reaches cross-origin, nested and sandboxed frames via the TOP host\'s setting', async (t) => {
    // Only the top host has an entry; the frame hosts are different origins.
    const page = await t.open(U('/fr/top.html', MAIN), { settings: mode('recolor', MAIN), extra: 1200 });
    await sleep(800);
    const child = await frameLuma(t, page, (u) => u.includes('child.localhost') && u.includes('light.html') && !u.includes('sand'));
    t.check('cross-origin iframe (host not in settings) is dark', child !== null && child < 0.3, String(child));
    const deep = await frameLuma(t, page, (u) => u.includes('deep.localhost'));
    t.check('iframe nested two levels deep is dark', deep !== null && deep < 0.3, String(deep));
    const sand = await frameLuma(t, page, (u) => u.includes('sand'));
    t.check('sandboxed iframe is dark', sand !== null && sand < 0.3, String(sand));
    const blocked = await frameLuma(t, page, (u) => u.includes('recaptcha'));
    t.check('captcha-host frames are skipped on purpose (stay light)', blocked !== null && blocked > 0.8, String(blocked));
    const srcdoc = await page.evaluate(() => {
      const d = document.getElementById('srcdoc').contentDocument;
      const c = getComputedStyle(d.body).backgroundColor.match(/\d+/g).map(Number);
      return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    });
    t.known('srcdoc / about:blank iframes are recolored', srcdoc < 0.3,
      'the content script has no match_about_blank, so srcdoc frames never get it', `luma ${srcdoc.toFixed(2)}`);
    t.check('top document itself is dark', (await t.bgLuma(page, '#card')) < 0.3);
  });

  scenario('iframes added after load are themed too', async (t) => {
    const page = await t.open(U('/fr/light.html', MAIN), { settings: mode('recolor', MAIN) });
    await page.evaluate((src) => {
      const f = document.createElement('iframe'); f.id = 'late'; f.src = src; f.style.cssText = 'width:300px;height:120px';
      document.body.appendChild(f);
    }, U('/fr/light.html?late', 'child.localhost'));
    await sleep(1800);
    const l = await frameLuma(t, page, (u) => u.includes('?late'));
    t.check('late iframe is dark', l !== null && l < 0.3, String(l));
  });

  scenario('Off removes the theme from every frame', async (t) => {
    const page = await t.open(U('/fr/top.html', MAIN), { settings: mode('recolor', MAIN), extra: 1500 });
    await t.live(page, OFF, ['off']);
    await sleep(800);
    const child = await frameLuma(t, page, (u) => u.includes('child.localhost') && !u.includes('sand') && u.includes('light.html'));
    const deep = await frameLuma(t, page, (u) => u.includes('deep.localhost'));
    t.check('child frame light again', child > 0.8, String(child));
    t.check('nested frame light again', deep > 0.8, String(deep));
  });

  scenario('invert: one filter on the top document covers frames (no per-frame work, no double inversion)', async (t) => {
    const page = await t.open(U('/fr/top.html', MAIN), { settings: mode('invert', MAIN), extra: 1000 });
    const r = await t.rect(page, '#child');
    const shot = await t.shot(page, 'frames-invert', { points: [[r.x + 40, r.y + 100], [r.x + 40, r.y + 20]] });
    t.check('iframe content is dark on screen', shot.at[0].luma < 0.35 || shot.at[1].luma < 0.35, JSON.stringify(shot.at));
    const f = frameBy(page, (u) => u.includes('child.localhost') && !u.includes('sand') && u.includes('light.html'));
    const inner = await f.evaluate(() => ({ attr: document.documentElement.getAttribute('data-force-dark'), filter: getComputedStyle(document.documentElement).filter, sheets: document.adoptedStyleSheets.length }));
    t.check('frame document itself is untouched', inner.attr === null && inner.filter === 'none' && inner.sheets === 0, JSON.stringify(inner));
  });

  // top page native-dark, child light: tab status must come from the top frame only
  server.add('/fr/native-top.html', doc(`<h1>dark top</h1><iframe src="${U('/fr/light.html', 'child.localhost')}"></iframe>`, {
    style: `body{background:#fff;color:#111}@media (prefers-color-scheme: dark){body{background:#111;color:#eee}}`,
  }));
  scenario('tab status is reported by the top frame only', async (t) => {
    const page = await t.open(U('/fr/native-top.html', MAIN), { settings: mode('auto', MAIN), extra: 1500 });
    t.check('status native (not the child\'s "recolor")', (await t.status(page)) === 'native', String(await t.status(page)));
    await sleep(2500);
    t.check('still native after late frame reports', (await t.status(page)) === 'native', String(await t.status(page)));
  });

  // auto falls back to invert; recolored frames must not end up light
  server.add('/auto/frame-red.png', pngBuffer('red', 24), { type: 'image/png' });
  server.add('/fr/hard-top.html', doc(`<h1>hard</h1><iframe id="child" src="${U('/fr/light.html', 'child.localhost')}" style="width:300px;height:130px"></iframe>`, {
    style: `@layer b{html,body{background:#fff !important;color:#111 !important}}`,
  }));
  scenario('Auto → Invert fallback re-inverts recolored frames so they stay dark', async (t) => {
    const page = await t.open(U('/fr/hard-top.html', MAIN), { settings: mode('auto', MAIN), extra: 800 });
    await t.waitStatus(page, 'invert', 12000);
    await sleep(800);
    t.check('top fell back to invert', (await t.status(page)) === 'invert', String(await t.status(page)));
    const r = await t.rect(page, '#child');
    const shot = await t.shot(page, 'frames-auto-invert', { points: [[r.x + 150, r.y + 110]] });
    t.check('frame area is dark (not double-inverted)', shot.at[0].luma < 0.35, shot.at[0].luma.toFixed(2));
  });
}
