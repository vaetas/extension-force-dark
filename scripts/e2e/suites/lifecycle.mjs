/* eslint-disable */
// Navigation, reloads, bfcache, SPAs, hostile pages, CSP, unusual documents.
import { mode, OFF, HOST, sleep } from '../harness.mjs';
import { doc, dataPng } from './_util.mjs';

export default function register({ scenario, server }) {
  const RECOLOR = mode('recolor');
  const CSS = 'body{background:#fff;color:#111;font-family:sans-serif}.card{background:#f1f1f1;padding:10px}';
  const page = (path, body = '<h1>page</h1><div class="card" id="card">card</div>', extra = {}) =>
    server.add(path, doc(body, { style: CSS, ...extra.docOpts }), extra.opts);

  // ---- reload / back-forward / SPA ----------------------------------------------------------
  page('/life/a.html', '<h1>A</h1><div class="card" id="card">A</div><a id="go" href="/life/b.html">b</a>', {
    docOpts: { head: `<script>window.__shows=[];addEventListener('pageshow',e=>window.__shows.push(e.persisted))</script>` },
  });
  page('/life/b.html', '<h1>B</h1><div class="card" id="card">B</div>');

  scenario('reload keeps the theme for every mode', async (t) => {
    for (const m of ['recolor', 'invert', 'auto']) {
      const p = await t.open('/life/a.html', { settings: mode(m) });
      await p.reload({ waitUntil: 'load' });
      await t.settled(p);
      const want = { recolor: 'recolor', invert: 'invert', auto: 'recolor' }[m];
      t.check(`${m}: status after reload`, (await t.waitStatus(p, want)) === want, String(await t.status(p)));
      const dark = m === 'invert' ? /invert/.test(await p.evaluate(() => getComputedStyle(document.documentElement).filter)) : (await t.bgLuma(p, '#card')) < 0.3;
      t.check(`${m}: still themed after reload`, dark);
      await p.close();
    }
  });

  scenario('back/forward navigation (bfcache) follows settings changes made while away', async (t) => {
    const p = await t.open('/life/a.html', { settings: RECOLOR });
    await p.goto(server.url('/life/b.html'), { waitUntil: 'load' });
    await t.setSettings(OFF);
    await sleep(500);
    await p.goBack({ waitUntil: 'load' });
    await sleep(900);
    const shows = await p.evaluate(() => window.__shows ?? []);
    if (!shows.includes(true)) return t.skip('bfcache', `page was reloaded, not restored from bfcache (pageshow.persisted=${JSON.stringify(shows)})`);
    t.check('restored page honours Off set while it was in bfcache', (await t.bgLuma(p, '#card')) > 0.8);
    await p.goto(server.url('/life/b.html'), { waitUntil: 'load' });
    await t.setSettings(RECOLOR);
    await sleep(500);
    await p.goBack({ waitUntil: 'load' });
    await sleep(1200);
    t.check('restored page honours Recolor set while it was in bfcache', (await t.bgLuma(p, '#card')) < 0.3);
  });

  page('/life/spa.html', '<div id="app"><h1>Home</h1><div class="card" id="card">home</div></div>', {
    docOpts: {
      head: `<script>
        window.route = (name) => {
          history.pushState({}, '', '/life/spa.html?r=' + name);
          if (name === 'two') {
            const s = document.createElement('style'); s.textContent = '#r2{background:#fff;color:#111;padding:10px}.fresh{background:#fafafa}'; document.head.appendChild(s);
          }
          document.getElementById('app').innerHTML = '<h1>' + name + '</h1><div id="r2" class="fresh" style="border-color:#ccc">route ' + name + '</div><div id="inl" style="background:#fff;color:#000;padding:8px">inline</div>';
        };
      </script>`,
    },
  });
  scenario('single-page app route changes: new styles and replaced DOM stay themed', async (t) => {
    const p = await t.open('/life/spa.html', { settings: RECOLOR });
    await p.evaluate(() => route('two'));
    await sleep(900);
    t.check('style added by the route is recolored', (await t.bgLuma(p, '#r2')) < 0.3);
    t.check('inline-styled node from innerHTML is recolored', (await t.bgLuma(p, '#inl')) < 0.3);
    await p.evaluate(() => route('three'));
    await sleep(600);
    t.check('next route (replaced DOM) still themed', (await t.bgLuma(p, '#inl')) < 0.3);
    t.check('status still recolor', (await t.status(p)) === 'recolor');
  });

  // ---- hostile pages ---------------------------------------------------------------------------------
  page('/life/reset-adopted.html', '<div class="card" id="card">x</div><div id="n1">1</div><div id="n2">2</div><div id="n3">3</div>', {
    docOpts: {
      head: `<script>
        // A framework hydrating: three times it replaces the whole adoptedStyleSheets array.
        const mk = (css) => { const s = new CSSStyleSheet(); s.replaceSync(css); return s; };
        const css = ['#card{background:#fff;color:#111;padding:10px}', '#n1{background:#fff;color:#111}', '#n2{background:#eee;color:#111}', '#n3{background:#f5f5f5;color:#111}'];
        setTimeout(() => { document.adoptedStyleSheets = [mk(css[0]), mk(css[1])]; }, 600);
        setTimeout(() => { document.adoptedStyleSheets = [mk(css[0]), mk(css[1]), mk(css[2])]; }, 1300);
        setTimeout(() => { document.adoptedStyleSheets = [mk(css[0]), mk(css[1]), mk(css[2]), mk(css[3])]; }, 2000);
      </script>`,
    },
  });
  scenario('framework that replaces document.adoptedStyleSheets several times while hydrating', async (t) => {
    const p = await t.open('/life/reset-adopted.html', { settings: RECOLOR, extra: 200 });
    await sleep(4200);
    for (const id of ['card', 'n1', 'n2', 'n3']) t.check(`#${id} is dark once the dust settles`, (await t.bgLuma(p, '#' + id)) < 0.3);
    const own = await p.evaluate(() => document.adoptedStyleSheets.length);
    t.check('override sheet is still the last adopted sheet', await p.evaluate(() => /color-scheme: dark/.test([...document.adoptedStyleSheets.at(-1).cssRules].map((r) => r.cssText).join(''))), `${own} sheets`);
  });

  page('/life/doc-write.html', '<p>placeholder</p>', {
    docOpts: {
      head: `<script>addEventListener('load', () => setTimeout(() => { document.open(); document.write('<!doctype html><html><head><style>body{background:#fff;color:#111}#card{background:#eee;padding:10px}</style></head><body><div id="card">rewritten document</div></body></html>'); document.close(); }, 300));</script>`,
    },
  });
  scenario('document.open()/write() replaces the whole document', async (t) => {
    const p = await t.open('/life/doc-write.html', { settings: RECOLOR });
    await sleep(2500);
    const l = await t.bgLuma(p, '#card');
    t.check('rewritten document is themed', l < 0.3, `luma ${l.toFixed(2)}`);
  });

  // hidden tabs: hydration happens while the user is on another tab
  page('/life/hidden.html', '<div class="card" id="card">x</div>', {
    docOpts: {
      head: `<script>
        addEventListener('load', () => setTimeout(() => {
          const s = new CSSStyleSheet(); s.replaceSync('#late{background:#fff;color:#111;padding:10px}');
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
          const d = document.createElement('div'); d.id = 'late'; d.textContent = 'hydrated'; document.body.appendChild(d);
        }, 1500));
      </script>`,
    },
  });
  scenario('late styles that arrive while the tab is in the background', async (t) => {
    const p = await t.open('/life/hidden.html', { settings: RECOLOR });
    const other = await t.open('/life/b.html', { settings: null, wait: false });
    let hidden = false;
    for (let i = 0; i < 12 && !hidden; i += 1) {
      await other.bringToFront();
      await sleep(250);
      hidden = (await p.evaluate(() => document.visibilityState)) === 'hidden';
    }
    if (!hidden) return t.skip('background tab', 'could not get the tab into visibilityState=hidden in this browser window');
    await sleep(2500); // page A hydrates while hidden
    t.check('page A hydrated while hidden', (await p.evaluate(() => !!document.getElementById('late'))));
    const lumaHidden = await t.bgLuma(p, '#late');
    await p.bringToFront();
    const samples = [];
    for (let i = 0; i < 10; i += 1) {
      await sleep(400);
      samples.push(`${(await t.bgLuma(p, '#late')).toFixed(2)}`);
    }
    t.note(`#late luma while hidden ${lumaHidden.toFixed(2)}; after returning every 400 ms: ${samples.join(' ')}`);
    t.check('after returning, hydrated content is themed within 4 s', Number(samples.at(-1)) < 0.3, samples.join(' '));
  });

  // ---- CSP / opaque origins -----------------------------------------------------------------------------
  server.add('/life/csp.css', '#card{background:#fff;color:#111;padding:10px}', { type: 'text/css' });
  server.add('/life/csp.js', "document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';", { type: 'text/javascript' });
  server.add('/life/csp.html', `<!doctype html><html><head><meta charset="utf-8"><title>csp</title><link rel="stylesheet" href="/life/csp.css"><script src="/life/csp.js"></script></head><body><div id="card">strict csp</div></body></html>`, {
    headers: { 'content-security-policy': "default-src 'none'; style-src 'self'; script-src 'self'; require-trusted-types-for 'script'" },
  });
  server.add('/life/sandboxed.html', doc('<div class="card" id="card">sandboxed document</div>', { style: CSS }), {
    headers: { 'content-security-policy': 'sandbox allow-scripts' },
  });
  scenario('strict CSP (style-src self, Trusted Types) and sandboxed top-level documents', async (t) => {
    for (const m of ['recolor', 'invert']) {
      const p = await t.open('/life/csp.html', { settings: mode(m) });
      const ok = m === 'invert' ? /invert/.test(await p.evaluate(() => getComputedStyle(document.documentElement).filter)) : (await t.bgLuma(p, '#card')) < 0.3;
      t.check(`CSP page: ${m} applies`, ok);
      await p.close();
    }
    const auto = await t.open('/life/csp.html', { settings: mode('auto') });
    await t.waitStatus(auto, ['recolor', 'native']);
    const theme = await auto.evaluate(() => document.documentElement.dataset.theme);
    t.check('CSP page: MAIN-world matchMedia patch is injected despite CSP', theme === 'dark' || (await t.bgLuma(auto, '#card')) < 0.3, `theme=${theme}`);
    const sb = await t.open('/life/sandboxed.html', { settings: RECOLOR });
    t.check('sandboxed (opaque-origin) top-level document is recolored', (await t.bgLuma(sb, '#card')) < 0.3);
  });

  // ---- documents that are not plain HTML pages ---------------------------------------------------------
  const docs = {
    'text/plain': ['text/plain; charset=utf-8', 'Just some plain text.\nSecond line.\n'],
    'application/json': ['application/json', '{"hello":"world","n":[1,2,3]}'],
    'application/xml': ['application/xml', '<?xml version="1.0"?><root><item>one</item><item>two</item></root>'],
    'image/svg+xml': ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#fff"/><text x="10" y="50" fill="#000">svg doc</text></svg>'],
    'application/xhtml+xml': ['application/xhtml+xml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>body{background:#fff;color:#111}</style></head><body><p id="p">xhtml</p></body></html>'],
    'text/css': ['text/css', 'body { background: #fff; }'],
  };
  for (const [name, [type, body]] of Object.entries(docs)) {
    server.add(`/life/doc-${name.replace(/\W/g, '_')}`, body, { type });
  }
  server.add('/life/doc-png', Buffer.from(dataPng('white', 64).split(',')[1], 'base64'), { type: 'image/png' });
  scenario('non-HTML documents (plain text, JSON, XML, SVG, XHTML, CSS, image) never crash or hang', async (t) => {
    const targets = [...Object.keys(docs).map((n) => [n, `/life/doc-${n.replace(/\W/g, '_')}`]), ['image/png', '/life/doc-png']];
    for (const m of ['recolor', 'invert', 'auto']) {
      for (const [name, path] of targets) {
        const p = await t.open(path, { settings: mode(m), wait: false, extra: 600 });
        const st = await t.waitStatus(p, ['recolor', 'invert', 'native'], 8000);
        const issues = (p.__issues ?? []).join(' | ');
        t.check(`${m} on ${name}: settles and reports`, ['recolor', 'invert', 'native'].includes(st) && !issues, `status=${st} ${issues.slice(0, 160)}`);
        p.__issues = [];
        await p.close();
      }
    }
    const plain = await t.open('/life/doc-text_plain', { settings: RECOLOR });
    const shot = await t.shot(plain, 'plain-text-recolor');
    t.check('plain text document is dark under recolor', shot.mean < 0.3, shot.mean.toFixed(2));
  });

  // ---- re-injection (what onInstalled does for tabs that were already open) -----------------------------
  scenario('re-injecting the content script into an already-themed tab is harmless', async (t) => {
    const p = await t.open('/life/b.html', { settings: RECOLOR });
    t.check('precondition: recolored', (await t.bgLuma(p, '#card')) < 0.3);
    const w = await t.getSW();
    const inject = () =>
      w.evaluate(async (u) => {
        const tab = (await chrome.tabs.query({})).find((x) => x.url === u);
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content-scripts/theme.js'] });
      }, p.url());
    await inject();
    await inject();
    await sleep(1200);
    t.check('still dark after two extra injections', (await t.bgLuma(p, '#card')) < 0.3);
    await t.setSettings(OFF);
    await sleep(1500);
    const left = await t.call(p, 'leftovers');
    const luma = await t.bgLuma(p, '#card');
    t.known('Off after re-injection removes the previous copy\'s overrides', luma > 0.8 && left.length === 0,
      'WXT marks the earlier instance invalid (ctx.isInvalid) so it ignores storage changes, and nothing reverts its override sheet — this is the extension-update path', `card luma ${luma.toFixed(2)}, leftovers: ${left.join(',')}`);
    await t.setSettings(mode('invert'));
    await t.waitStatus(p, 'invert');
    const adopted = await p.evaluate(() => document.adoptedStyleSheets.length);
    t.known('switching to invert afterwards leaves no recolor sheets', adopted === 0,
      'same orphaned instance: its sheet stays adopted and fights the inversion', `adopted ${adopted}`);
  });
}
