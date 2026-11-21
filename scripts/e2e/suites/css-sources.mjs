/* eslint-disable */
// Where colours can come from on a real page, and whether recolor reaches them.
import { mode, HOST, sleep } from '../harness.mjs';
import { doc, expectDark, expectLightText } from './_util.mjs';

export default function register({ scenario, server }) {
  const RECOLOR = mode('recolor');
  const CDN = 'cdn.localhost';
  const L = '#fff';

  // ---- external stylesheets -------------------------------------------------
  server.add('/css/same.css', '#same { background: #fff; color: #222; padding: 8px }', { type: 'text/css' });
  server.add('/css/cross.css', '#cross { background: #f0f0f0; color: #111; padding: 8px }', { type: 'text/css' });
  server.add('/css/imp.css', '#imp { background: #fafafa; color: #111; padding: 8px }', { type: 'text/css' });
  server.add('/css/with-import.css', "@import url('/css/imp.css'); #own { background: #fff; padding: 8px }", { type: 'text/css' });
  server.add(
    '/css/cross-import.css',
    `@import url('${server.url('/css/imp.css', CDN)}'); #own2 { background: #fff; padding: 8px }`,
    { type: 'text/css' },
  );
  server.add(
    '/sources/external.html',
    doc(
      `<div id="same">same-origin</div><div id="cross">cross-origin</div><div id="missing">cross 404</div>`,
      {
        head: `<link rel="stylesheet" href="/css/same.css">
               <link rel="stylesheet" href="${server.url('/css/cross.css', CDN)}">
               <link rel="stylesheet" href="${server.url('/css/does-not-exist.css', CDN)}">`,
      },
    ),
  );

  scenario('external stylesheets: same-origin and cross-origin (no CORS) are recolored', async (t) => {
    const page = await t.open('/sources/external.html', { settings: RECOLOR });
    await expectDark(t, page, '#same', 'same-origin sheet');
    await expectDark(t, page, '#cross', 'cross-origin sheet (fetched by background)');
    await expectLightText(t, page, '#cross', 'cross-origin sheet');
    t.check('page survived a 404 stylesheet', (await t.status(page)) === 'recolor');
  });

  server.add(
    '/sources/import.html',
    doc(`<div id="own">own</div><div id="imp">imported</div>`, {
      head: `<link rel="stylesheet" href="/css/with-import.css">`,
    }),
  );
  scenario('@import: rules pulled in through @import are recolored', async (t) => {
    const page = await t.open('/sources/import.html', { settings: RECOLOR });
    await expectDark(t, page, '#own', 'rule in importing sheet');
    const l = await t.bgLuma(page, '#imp');
    t.known('rule inside @import-ed sheet is dark', l < 0.3,
      'walkStyleRules skips CSSImportRule, and imported sheets are not in document.styleSheets', `luma ${l.toFixed(2)}`);
  });

  server.add(
    '/sources/import-cross.html',
    doc(`<div id="own2">own</div><div id="imp">imported</div>`, {
      head: `<link rel="stylesheet" href="/css/cross-import.css">`,
    }),
  );
  scenario('@import: cross-origin @import chain', async (t) => {
    const page = await t.open('/sources/import-cross.html', { settings: RECOLOR });
    await expectDark(t, page, '#own2', 'rule in sheet that has a cross-origin @import');
    const l = await t.bgLuma(page, '#imp');
    t.known('rule inside cross-origin @import-ed sheet is dark', l < 0.3,
      'same @import gap; not visible in document.styleSheets', `luma ${l.toFixed(2)}`);
  });

  // ---- modern CSS syntax ------------------------------------------------------
  server.add(
    '/sources/modern.html',
    doc(
      `<div class="card" id="card"><p class="inner" id="inner">nested</p><p id="nested-amp">amp</p></div>
       <div class="wrap" id="wrap"><div class="boxc" id="container">container</div></div>
       <div id="supports">supports</div>
       <div id="layered">layered</div>
       <div id="layered-important">layered !important</div>
       <div id="media">media</div>
       <div id="scope-host" class="scope"><span id="scoped">scoped</span></div>`,
      {
        style: `
        body { font-family: sans-serif }
        .card { background: #ffffff; padding: 8px;
          .inner { background: #f1f1f1; color: #111 }
          & #nested-amp { background: #eeeeee; color: #111 }
        }
        .wrap { container-type: inline-size }
        @container (min-width: 100px) { .boxc { background: #f5f5f5; color: #111 } }
        @supports (display: grid) { #supports { background: #fafafa; color: #111 } }
        @layer base { #layered { background: #fff; color: #111 } }
        @layer base { #layered-important { background: #fff !important; color: #111 } }
        @media (min-width: 600px) { #media { background: #f0f0f0; color: #111 } }
        @scope (.scope) { span { background: #eee; color: #111 } }
        `,
      },
    ),
  );
  scenario('modern at-rules: nesting, @container, @supports, @layer, @media, @scope', async (t) => {
    const page = await t.open('/sources/modern.html', { settings: RECOLOR });
    await expectDark(t, page, '#card', 'plain rule (control)');
    await expectDark(t, page, '#supports', '@supports');
    await expectDark(t, page, '#layered', '@layer');
    await expectDark(t, page, '#media', '@media (min-width)');

    for (const [sel, label, why] of [
      ['#inner', 'CSS nesting (child rule)', 'CSSStyleRule.cssRules (nested rules) are not walked'],
      ['#nested-amp', 'CSS nesting (& selector)', 'CSSStyleRule.cssRules (nested rules) are not walked'],
      ['#container', '@container query', 'CSSContainerRule is not handled by walkStyleRules'],
      ['#scoped', '@scope', 'CSSScopeRule is not handled by walkStyleRules'],
      ['#layered-important', '@layer + !important', 'layered !important beats our unlayered !important'],
    ]) {
      const l = await t.bgLuma(page, sel);
      t.known(`${label} is dark`, l < 0.3, why, `luma ${l.toFixed(2)}`);
    }
  });

  // ---- shadow DOM ---------------------------------------------------------------
  server.add(
    '/sources/shadow.html',
    doc(`<div id="open-host"></div><div id="nested-host"></div><div id="adopted-host"></div>
         <div id="closed-host"></div>
         <div id="dsd"><template shadowrootmode="open"><style>.in { background: #fff; color: #111; padding: 6px }</style><div class="in" id="dsd-in">declarative</div></template></div>
         <script>
           const mk = (host, css, html, mode) => {
             const sr = host.attachShadow({ mode });
             sr.innerHTML = '<style>' + css + '</style>' + html;
             return sr;
           };
           mk(document.getElementById('open-host'), '.in{background:#fff;color:#111;padding:6px}', '<div class="in" id="open-in">open</div>', 'open');
           const outer = mk(document.getElementById('nested-host'), '.o{background:#eee;padding:6px}', '<div class="o" id="outer-in">outer</div><div id="inner-host"></div>', 'open');
           mk(outer.getElementById('inner-host'), '.i{background:#fff;color:#000;padding:6px}', '<div class="i" id="inner-in">inner</div>', 'open');
           const ad = document.getElementById('adopted-host').attachShadow({ mode: 'open' });
           const s = new CSSStyleSheet(); s.replaceSync('.a{background:#f4f4f4;color:#111;padding:6px}'); ad.adoptedStyleSheets = [s];
           ad.innerHTML = '<div class="a" id="adopted-in">adopted</div>';
           const closed = mk(document.getElementById('closed-host'), '.c{background:#fff;color:#111;padding:6px}', '<div class="c" id="closed-in">closed</div>', 'closed');
           window.__closedInner = closed.getElementById('closed-in');
         </script>`),
  );
  scenario('shadow DOM: open, nested, adopted, declarative and closed roots', async (t) => {
    const page = await t.open('/sources/shadow.html', { settings: RECOLOR });
    await sleep(500);
    await t.lib(page);
    const l = {
      open: await page.evaluate(() => __t.bgLuma(document.getElementById('open-host').shadowRoot.getElementById('open-in'))),
      outer: await page.evaluate(() => __t.bgLuma(document.getElementById('nested-host').shadowRoot.getElementById('outer-in'))),
      inner: await page.evaluate(() => __t.bgLuma(document.getElementById('nested-host').shadowRoot.getElementById('inner-host').shadowRoot.getElementById('inner-in'))),
      adopted: await page.evaluate(() => __t.bgLuma(document.getElementById('adopted-host').shadowRoot.getElementById('adopted-in'))),
      dsd: await page.evaluate(() => __t.bgLuma(document.getElementById('dsd').shadowRoot.getElementById('dsd-in'))),
      closed: await page.evaluate(() => __t.bgLuma(window.__closedInner)),
    };
    t.check('open shadow root <style> is recolored', l.open < 0.3, `luma ${l.open.toFixed(2)}`);
    t.check('nested shadow roots are recolored', l.outer < 0.3 && l.inner < 0.3, JSON.stringify(l));
    t.check('shadow root adoptedStyleSheets are recolored', l.adopted < 0.3, `luma ${l.adopted.toFixed(2)}`);
    t.check('declarative shadow DOM is recolored', l.dsd < 0.3, `luma ${l.dsd.toFixed(2)}`);
    t.known('closed shadow root is recolored', l.closed < 0.3, 'element.shadowRoot is null for closed roots; the content script cannot reach them', `luma ${l.closed.toFixed(2)}`);
  });

  // ---- inline styles & presentational attributes ------------------------------
  server.add(
    '/sources/inline.html',
    doc(
      `<div id="static" style="background:#fff;color:#111;padding:6px">static</div>
       <div id="important" style="background:#fff !important;color:#111;padding:6px">important</div>
       <div id="js-prop" style="padding:6px">style.background</div>
       <div id="js-attr" style="padding:6px">setAttribute(style)</div>
       <div id="js-css" style="padding:6px">cssText</div>
       <div id="later" style="padding:6px">inserted later</div>
       <div id="inner-html-host"></div>
       <div id="inline-var" style="--surface:#fff;padding:6px">inline custom property</div>
       <svg width="60" height="20"><rect id="svg-attr" width="60" height="20" fill="#222"/></svg>
       <svg width="60" height="20"><rect id="svg-style" width="60" height="20" style="fill:#222"/></svg>`,
      {
        style: `.uses-var { background: var(--surface) } #inline-var { background: var(--surface) }`,
        head: `<script>
          addEventListener('DOMContentLoaded', () => {
            document.getElementById('js-prop').style.background = '#fff';
            document.getElementById('js-prop').style.color = '#111';
            document.getElementById('js-attr').setAttribute('style', 'background:#fff;color:#111;padding:6px');
            document.getElementById('js-css').style.cssText = 'background:#eee;color:#111;padding:6px';
            setTimeout(() => {
              const d = document.createElement('div');
              d.id = 'late-el'; d.textContent = 'late'; d.style.cssText = 'background:#fff;color:#111;padding:6px';
              document.getElementById('later').appendChild(d);
              document.getElementById('inner-html-host').innerHTML = '<div id="from-html" style="background:#fff;color:#111;padding:6px"><span id="from-html-child" style="background:#f3f3f3;color:#111">child</span></div>';
            }, 700);
          });
        </script>`,
      },
    ),
  );
  scenario('inline styles: static, !important, set from JS, inserted later, innerHTML', async (t) => {
    const page = await t.open('/sources/inline.html', { settings: RECOLOR, extra: 900 });
    for (const [sel, label] of [
      ['#static', 'static style="…"'],
      ['#important', 'inline !important'],
      ['#js-prop', 'el.style.background = …'],
      ['#js-attr', "setAttribute('style', …)"],
      ['#js-css', 'style.cssText = …'],
      ['#late-el', 'element inserted later'],
      ['#from-html', 'innerHTML-injected element'],
      ['#from-html-child', 'nested innerHTML child'],
    ]) {
      await expectDark(t, page, sel, label);
    }
    const important = await page.$eval('#important', (el) => el.style.getPropertyPriority('background'));
    t.check('inline !important priority is preserved', important === 'important', important);
  });

  scenario('inline styles: custom properties and SVG paint', async (t) => {
    const page = await t.open('/sources/inline.html', { settings: RECOLOR, extra: 900 });
    let l = await t.bgLuma(page, '#inline-var');
    t.known('inline custom property (style="--surface:#fff") is recolored', l < 0.3,
      'inline custom properties are skipped (property.startsWith("--"))', `luma ${l.toFixed(2)}`);
    await t.lib(page);
    const svgAttr = await page.evaluate(() => __t.lum(getComputedStyle(document.getElementById('svg-attr')).fill));
    const svgStyle = await page.evaluate(() => __t.lum(getComputedStyle(document.getElementById('svg-style')).fill));
    t.known('SVG fill="#222" attribute is lightened', svgAttr > 0.5,
      'presentation attributes are not CSS rules, never rewritten', `luma ${svgAttr.toFixed(2)}`);
    t.check('SVG style="fill:#222" is lightened', svgStyle > 0.5, `luma ${svgStyle.toFixed(2)}`);
  });

  server.add(
    '/sources/presentational.html',
    `<!doctype html><html><head><title>old school</title></head>
     <body bgcolor="#ffffff" text="#000000" link="#0000ee">
       <table id="outer" width="85%" bgcolor="#f6f6ef" cellpadding="8"><tr>
         <td id="header" bgcolor="#ff6600"><font color="#000000" id="hdr-font">Header</font></td></tr>
         <tr><td id="cell" bgcolor="#f6f6ef"><font id="body-font" color="#828282">grey comment text</font> <a href="#">link</a></td></tr>
       </table></body></html>`,
  );
  scenario('presentational HTML attributes: bgcolor / <font color> (Hacker News style)', async (t) => {
    const page = await t.open('/sources/presentational.html', { settings: RECOLOR });
    await expectDark(t, page, 'body', 'body[bgcolor]');
    for (const [sel, label] of [['#outer', 'table[bgcolor]'], ['#cell', 'td[bgcolor]']]) {
      const l = await t.bgLuma(page, sel);
      t.known(`${label} is dark`, l < 0.3, 'bgcolor is a presentational hint, not a CSSOM rule, so it is never rewritten', `luma ${l.toFixed(2)}`);
    }
    const f = await t.fgLuma(page, '#hdr-font');
    const hb = await t.bgLuma(page, '#header');
    t.check('header cell keeps readable text (contrast)', (await t.call(page, 'contrastOf', '#hdr-font')) >= 3,
      `fg ${f.toFixed(2)} on bg ${hb.toFixed(2)}`);
    const scan = await t.call(page, 'textScan', {});
    t.known('no unreadable text overall', scan.lowFrac < 0.02,
      'recolored light text lands on td[bgcolor] cells that stay light', JSON.stringify(scan.offenders));
  });

  // ---- dynamic stylesheets ----------------------------------------------------------
  server.add('/css/late.css', '#late-link { background: #fff; color: #111; padding: 6px }', { type: 'text/css' });
  server.add('/css/swap-a.css', '#swap-link { background: #fff; color: #111; padding: 6px }', { type: 'text/css' });
  server.add('/css/swap-b.css', '#swap-link { background: #eee; color: #111; padding: 6px }', { type: 'text/css' });
  server.add('/css/disabled.css', '#enabled-later { background: #fff; color: #111; padding: 6px }', { type: 'text/css' });
  server.add(
    '/sources/dynamic.html',
    doc(
      ['late-style', 'late-link', 'insert-rule', 'swap-link', 'enabled-later', 'media-switch', 'adopted-late']
        .map((id) => `<div id="${id}">${id}</div>`)
        .join(''),
      {
        style: `div { padding: 6px; color: #111 } #insert-rule-seed { color: #111 }`,
        head: `
        <link id="dis" rel="stylesheet" href="/css/disabled.css" disabled>
        <link id="swap" rel="stylesheet" href="/css/swap-a.css">
        <style id="media-style" media="print">#media-switch { background: #fff; padding: 6px }</style>
        <script>
          const doc = document;
          addEventListener('DOMContentLoaded', () => {
            const seed = doc.createElement('style');
            seed.textContent = '#insert-rule { color: #111 }';
            doc.head.appendChild(seed);
            const swap = doc.getElementById('swap');
            setTimeout(() => {
              const s = doc.createElement('style'); s.textContent = '#late-style { background:#fff; color:#111 }'; doc.head.appendChild(s);
            }, 700);
            setTimeout(() => {
              const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/late.css';
              doc.head.appendChild(l);
            }, 900);
            setTimeout(() => { seed.sheet.insertRule('#insert-rule { background: #fff }', seed.sheet.cssRules.length); }, 1100);
            setTimeout(() => { swap.href = '/css/swap-b.css'; }, 1700);
            setTimeout(() => { doc.getElementById('dis').disabled = false; }, 1900);
            setTimeout(() => { doc.getElementById('media-style').media = 'all'; }, 2100);
            setTimeout(() => {
              const s2 = new CSSStyleSheet(); s2.replaceSync('#adopted-late { background:#fff; color:#111 }');
              doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, s2];
            }, 2300);
          });
        </script>`,
      },
    ),
  );
  scenario('dynamic stylesheets: everything a page can do to its CSS after load', async (t) => {
    const page = await t.open('/sources/dynamic.html', { settings: RECOLOR, extra: 4500 });
    await expectDark(t, page, '#late-style', '<style> appended after load');
    await expectDark(t, page, '#late-link', '<link> appended after load');
    await expectDark(t, page, '#insert-rule', 'CSSStyleSheet.insertRule (CSS-in-JS "speedy")');
    await expectDark(t, page, '#adopted-late', 'new adoptedStyleSheet added later');
    await expectDark(t, page, '#swap-link', '<link href> swapped to a different sheet');
    await expectDark(t, page, '#enabled-later', 'disabled <link> enabled later');
    await expectDark(t, page, '#media-switch', '<style media> switched from print to all');
  });

  // Isolated: nothing else happens afterwards, so only the poll can notice.
  const swapPage = (script) =>
    doc(`<div id="a">a</div><div id="b">b</div>`, {
      style: 'div { padding: 6px; color: #111 }',
      head: `<script>${script}</script>`,
    });
  server.add('/sources/replace-sync.html', swapPage(`
    const sheet = new CSSStyleSheet(); sheet.replaceSync('#a { background: #fff }');
    document.adoptedStyleSheets = [sheet];
    setTimeout(() => sheet.replaceSync('#b { background: #eee }'), 1200);`));
  server.add('/sources/delete-insert.html', swapPage(`
    addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style'); s.textContent = '#a { background: #fff }'; document.head.appendChild(s);
      setTimeout(() => { s.sheet.deleteRule(0); s.sheet.insertRule('#b { background: #eee }', 0); }, 1200);
    });`));
  server.add('/sources/insert-rule.html', swapPage(`
    addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style'); s.textContent = '#a { background: #fff }'; document.head.appendChild(s);
      setTimeout(() => s.sheet.insertRule('#b { background: #eee }', 1), 1200);
    });`));
  scenario('late CSSOM edits with no DOM mutation (CSS-in-JS, hydration)', async (t) => {
    const ins = await t.open('/sources/insert-rule.html', { settings: RECOLOR, extra: 3000 });
    await expectDark(t, ins, '#b', 'insertRule adding a rule (rule count changes)');
    const rs = await t.open('/sources/replace-sync.html', { settings: RECOLOR, extra: 3000 });
    const l1 = await t.bgLuma(rs, '#b');
    t.known('replaceSync() swapping in a different rule (same count) is dark', l1 < 0.3,
      'change detection (signatureOf) compares rule counts only', `luma ${l1.toFixed(2)}`);
    const di = await t.open('/sources/delete-insert.html', { settings: RECOLOR, extra: 3000 });
    const l2 = await t.bgLuma(di, '#b');
    t.known('deleteRule + insertRule swapping a rule (same count) is dark', l2 < 0.3,
      'change detection (signatureOf) compares rule counts only', `luma ${l2.toFixed(2)}`);
  });

  // ---- keyframes, @property ------------------------------------------------------------
  server.add(
    '/sources/animated.html',
    doc(
      `<div id="pulse">pulse</div><div id="prop">registered property</div>`,
      {
        style: `
        @keyframes pulse { from { background: #fff } to { background: #eee } }
        #pulse { animation: pulse 1s infinite alternate; padding: 8px; color: #111 }
        @property --reg { syntax: '<color>'; inherits: false; initial-value: #ffffff }
        #prop { background: var(--reg); padding: 8px; color: #111 }`,
      },
    ),
  );
  scenario('@keyframes and @property colours', async (t) => {
    const page = await t.open('/sources/animated.html', { settings: RECOLOR });
    await sleep(300);
    const kf = await t.bgLuma(page, '#pulse');
    t.known('@keyframes background animation is dark', kf < 0.3, 'CSSKeyframesRule is not walked', `luma ${kf.toFixed(2)}`);
    const prop = await t.bgLuma(page, '#prop');
    t.known('@property initial-value colour is dark', prop < 0.3, 'registered-property initial values are not rewritten', `luma ${prop.toFixed(2)}`);
  });

  // ---- media-query contexts --------------------------------------------------------------
  server.add(
    '/sources/mq.html',
    doc(`<div id="mobile">mobile-only rule</div><div id="light-mq">prefers-color-scheme: light rule</div><div id="dark-mq">dark rule</div>`, {
      style: `
      div { padding: 8px; color: #111 }
      @media (max-width: 400px) { #mobile { background: #fff } }
      @media (prefers-color-scheme: light) { #light-mq { background: #fff } }
      @media (prefers-color-scheme: dark) { #dark-mq { background: #101010; color: #eee } }`,
    }),
  );
  scenario('media queries keep their context after rewriting', async (t) => {
    const page = await t.open('/sources/mq.html', { settings: RECOLOR });
    await expectDark(t, page, '#light-mq', '@media (prefers-color-scheme: light) rule');
    t.check('rule outside its media query is not applied (desktop)', (await t.bgLuma(page, '#mobile')) < 0.3 /* page bg shows through */);
    await page.setViewport({ width: 360, height: 700 });
    await sleep(500);
    await expectDark(t, page, '#mobile', '@media (max-width) rule once the viewport matches');
    const bg = await page.$eval('#mobile', (el) => getComputedStyle(el).backgroundColor);
    t.check('mobile rule is dark, not the original white', !/255, 255, 255/.test(bg), bg);
  });

  scenario('site that already has a dark theme and the OS is dark: recolor does not wreck it', async (t) => {
    const page = await t.open('/sources/mq.html', { settings: RECOLOR, scheme: 'dark' });
    await expectDark(t, page, '#dark-mq', "site's own dark rule", 0.2);
    await expectLightText(t, page, '#dark-mq', "site's own dark rule");
    const c = await t.call(page, 'contrastOf', '#dark-mq');
    t.check('own dark theme keeps high contrast', c > 7, `contrast ${c.toFixed(1)}`);
  });
}
