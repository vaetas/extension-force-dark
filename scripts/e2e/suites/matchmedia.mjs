/* eslint-disable */
// The MAIN-world matchMedia proxy must behave like the real MediaQueryList.
import { mode, OFF, sleep } from '../harness.mjs';
import { doc } from './_util.mjs';

export default function register({ scenario, server }) {
  const AUTO = mode('auto');
  server.add('/mm/page.html', doc('<h1 id="h">mm</h1><div id="x">x</div>', {
    style: `body{background:#fff;color:#111}@media (prefers-color-scheme: dark){body{background:#101214;color:#eee}}`,
  }));

  scenario('forced prefers-color-scheme: queries, media text, comma lists, print', async (t) => {
    const page = await t.open('/mm/page.html', { settings: AUTO });
    t.check('precondition: native', (await t.status(page)) === 'native');
    const r = await page.evaluate(() => {
      const q = (s) => matchMedia(s);
      return {
        dark: q('(prefers-color-scheme: dark)').matches,
        light: q('(prefers-color-scheme: light)').matches,
        noPref: q('(prefers-color-scheme: no-preference)').matches,
        bool: q('(prefers-color-scheme)').matches,
        and: q('(prefers-color-scheme: dark) and (min-width: 10px)').matches,
        andLight: q('(prefers-color-scheme: light) and (min-width: 10px)').matches,
        list: q('(prefers-color-scheme: dark), (min-width: 10px)').matches,
        listPrint: q('(prefers-color-scheme: dark), print').matches,
        unrelated: q('(min-width: 10px)').matches,
        unrelatedFalse: q('(min-width: 99999px)').matches,
        print: q('print and (prefers-color-scheme: dark)').matches,
        media: q('(prefers-color-scheme:dark)').media,
        unrelatedIsReal: q('(min-width: 10px)') instanceof MediaQueryList,
      };
    });
    t.check('dark → true', r.dark === true);
    t.check('light → false', r.light === false);
    t.check('dark AND width → true; light AND width → false', r.and === true && r.andLight === false);
    t.check('comma list containing dark → true', r.list === true);
    t.known('comma list that merely mentions print → true', r.listPrint === true,
      'isPrintMedia() skips any query text containing the word "print", even other branches of a list', String(r.listPrint));
    t.check('unrelated queries keep their real answers', r.unrelated === true && r.unrelatedFalse === false);
    t.check('queries unrelated to colour scheme are real MediaQueryList objects', r.unrelatedIsReal);
    t.check('.media echoes the original query text', r.media === '(prefers-color-scheme:dark)', r.media);
    t.check('print-only context is not forced', r.print === false, String(r.print));
  });

  scenario('change events: listeners, removal, legacy API', async (t) => {
    const page = await t.open('/mm/page.html', { settings: AUTO });
    await page.evaluate(() => {
      window.__ev = { a: [], b: [], legacy: [], obj: [] };
      const m = matchMedia('(prefers-color-scheme: dark)');
      window.__m = m;
      window.__a = (e) => window.__ev.a.push(e.matches);
      window.__b = (e) => window.__ev.b.push(e.matches);
      m.addEventListener('change', window.__a);
      m.addEventListener('change', window.__b);
      m.removeEventListener('change', window.__b);
      window.__l = (e) => window.__ev.legacy.push(e.matches);
      m.addListener(window.__l);
      m.addEventListener('change', { handleEvent: (e) => window.__ev.obj.push(e.matches) });
    });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await sleep(150);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await sleep(150);
    const ev = await page.evaluate(() => window.__ev);
    t.check('addEventListener listener is called on OS changes', ev.a.length >= 1, JSON.stringify(ev));
    t.check('listeners always see the forced value (true)', ev.a.every((v) => v === true), JSON.stringify(ev.a));
    t.check('removeEventListener works', ev.b.length === 0, JSON.stringify(ev.b));
    t.check('legacy addListener works', ev.legacy.length >= 1 && ev.legacy.every((v) => v === true), JSON.stringify(ev.legacy));
    t.check('handleEvent objects work', ev.obj.length >= 1, JSON.stringify(ev.obj));
    await page.evaluate(() => { window.__m.removeListener(window.__l); window.__ev.legacy.length = 0; });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await sleep(150);
    t.check('legacy removeListener works', (await page.evaluate(() => window.__ev.legacy.length)) === 0);
  });

  scenario('onchange handler sees the forced value too', async (t) => {
    const page = await t.open('/mm/page.html', { settings: AUTO });
    await page.evaluate(() => {
      window.__on = [];
      const m = matchMedia('(prefers-color-scheme: dark)');
      m.onchange = (e) => window.__on.push(e.matches);
    });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await sleep(150);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await sleep(150);
    const on = await page.evaluate(() => window.__on);
    t.known('onchange receives matches=true for every event', on.length > 0 && on.every((v) => v === true),
      'onchange is forwarded to the real MediaQueryList, whose event carries the real (unforced) value', JSON.stringify(on));
  });

  scenario('turning Auto off gives back the real answers (and CSS)', async (t) => {
    const page = await t.open('/mm/page.html', { settings: AUTO });
    t.check('forced while on', await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches));
    await t.live(page, OFF, ['off']);
    const r = await page.evaluate(() => ({
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      light: matchMedia('(prefers-color-scheme: light)').matches,
      attr: document.documentElement.getAttribute('data-force-dark-scheme'),
      cs: document.documentElement.style.colorScheme,
    }));
    t.check('real values again (light OS)', r.dark === false && r.light === true, JSON.stringify(r));
    t.check('scheme attribute and inline color-scheme removed', r.attr === null && r.cs === '', JSON.stringify(r));
  });

  scenario('dark @media rules added after load: insertRule and <style media>', async (t) => {
    const page = await t.open('/mm/page.html', { settings: AUTO });
    await page.evaluate(() => {
      for (const id of ['ir', 'sm']) {
        const d = document.createElement('div'); d.id = id; d.textContent = id; document.body.appendChild(d);
      }
      const s = document.createElement('style'); document.head.appendChild(s);
      s.sheet.insertRule('@media (prefers-color-scheme: dark){#ir{background:#123456}}', 0);
      const m = document.createElement('style'); m.media = '(prefers-color-scheme: dark)'; m.textContent = '#sm{background:#234567}'; document.head.appendChild(m);
    });
    await sleep(1200);
    const got = await page.evaluate(() => Object.fromEntries(['ir', 'sm'].map((id) => [id, getComputedStyle(document.getElementById(id)).backgroundColor])));
    t.check('insertRule into an existing sheet', got.ir === 'rgb(18, 52, 86)', got.ir);
    t.check('<style media="(prefers-color-scheme: dark)"> added later', got.sm === 'rgb(35, 69, 103)', got.sm);
  });

  // Isolated: no DOM mutation accompanies the adoption, so only polling could notice.
  server.add('/mm/adopted-late.html', doc('<div id="ad">adopted</div>', {
    style: 'body{background:#fff;color:#111}@media (prefers-color-scheme: dark){body{background:#101214;color:#eee}}',
    head: `<script>setTimeout(() => { const a = new CSSStyleSheet(); a.replaceSync('@media (prefers-color-scheme: dark){#ad{background:#345678}}'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, a]; }, 1000);</script>`,
  }));
  scenario('dark @media inside an adoptedStyleSheet added late (no DOM mutation)', async (t) => {
    const page = await t.open('/mm/adopted-late.html', { settings: AUTO });
    await sleep(3000);
    const bg = await page.evaluate(() => getComputedStyle(document.getElementById('ad')).backgroundColor);
    t.known('late adopted sheet\'s dark @media is applied', bg === 'rgb(52, 86, 120)',
      'constructed sheets are only re-scanned on DOM mutations / load events, and replaceSync() does not call the patched insertRule', bg);
  });
}
