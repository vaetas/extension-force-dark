/* eslint-disable */
// The CSS-variable / utility-class patterns that real light-only sites ship.
import { mode, sleep } from '../harness.mjs';
import { doc, expectDark, expectLightText } from './_util.mjs';

export default function register({ scenario, server }) {
  const RECOLOR = mode('recolor');

  const page = (name, style, body, head = '') => {
    server.add(`/fw/${name}.html`, doc(body, { style, head }));
    return `/fw/${name}.html`;
  };

  // Tailwind v3: channel triplets with an opacity variable.
  const tw3 = page(
    'tw3',
    `*{--tw-bg-opacity:1;--tw-text-opacity:1;--tw-border-opacity:1}
     .bg-white{background-color:rgb(255 255 255/var(--tw-bg-opacity))}
     .bg-gray-50{background-color:rgb(249 250 251/var(--tw-bg-opacity))}
     .bg-white\\/80{background-color:rgb(255 255 255/.8)}
     .text-gray-900{color:rgb(17 24 39/var(--tw-text-opacity))}
     .text-gray-500{color:rgb(107 114 128/var(--tw-text-opacity))}
     .border{border-width:1px;border-style:solid}
     .border-gray-200{border-color:rgb(229 231 235/var(--tw-border-opacity))}
     .p-4{padding:1rem}`,
    `<div id="wrap" class="bg-gray-50 p-4"><div id="card" class="bg-white text-gray-900 border border-gray-200 p-4">card
       <span id="muted" class="text-gray-500">muted</span></div><div id="glass" class="bg-white/80 text-gray-900 p-4">translucent</div></div>`,
  );
  scenario('Tailwind v3: rgb(r g b / var(--tw-*-opacity))', async (t) => {
    const p = await t.open(tw3, { settings: RECOLOR });
    const WHY = 'rgb(r g b / var(--x)): channels are left untouched (only the var() is wrapped), so the colour stays light — Tailwind v3\'s whole palette';
    await expectDark(t, p, '#glass', 'bg-white/80 (literal alpha)');
    for (const [sel, label] of [['#wrap', 'bg-gray-50'], ['#card', 'bg-white']]) {
      const l = await t.bgLuma(p, sel);
      t.known(`${label} is dark`, l < 0.3, WHY, `luma ${l.toFixed(2)}`);
    }
    for (const [sel, label] of [['#card', 'text-gray-900'], ['#muted', 'text-gray-500']]) {
      const l = await t.fgLuma(p, sel);
      t.known(`${label} text is light`, l > 0.45, WHY, `luma ${l.toFixed(2)}`);
    }
    const border = await p.$eval('#card', (el) => getComputedStyle(el).borderTopColor);
    await t.lib(p);
    const bl = await p.evaluate((c) => __t.lum(c), border);
    t.known('border-gray-200 is darkened', bl < 0.5, WHY, `luma ${bl.toFixed(2)}`);
  });

  // Tailwind v4: oklch design tokens + color-mix for opacity modifiers.
  const tw4 = page(
    'tw4',
    `@layer theme{:root{--color-white:#fff;--color-gray-50:oklch(98.5% .002 247.839);--color-gray-900:oklch(21% .034 264.665);--color-gray-200:oklch(92.8% .006 264.531)}}
     @layer utilities{
       .bg-gray-50{background-color:var(--color-gray-50)}
       .bg-white{background-color:var(--color-white)}
       .bg-white\\/50{background-color:color-mix(in oklab,var(--color-white) 50%,transparent)}
       .text-gray-900{color:var(--color-gray-900)}
       .border-gray-200{border-color:var(--color-gray-200)}
       .border{border-style:solid;border-width:1px}
       .p-4{padding:16px}}`,
    `<div id="wrap" class="bg-gray-50 p-4"><div id="card" class="bg-white text-gray-900 border border-gray-200 p-4">card</div>
      <div id="glass" class="bg-white/50 text-gray-900 p-4">modifier</div></div>`,
  );
  scenario('Tailwind v4: oklch tokens inside @layer, color-mix opacity modifiers', async (t) => {
    const p = await t.open(tw4, { settings: RECOLOR });
    await expectDark(t, p, '#card', 'bg-white (#fff token)');
    for (const [sel, label] of [['#wrap', 'bg-gray-50 (oklch token)'], ['#glass', 'bg-white/50 (color-mix)']]) {
      const l = await t.bgLuma(p, sel);
      t.known(`${label} is dark`, l < 0.3, 'oklch / color-mix() values are not parsed (see colors suite)', `luma ${l.toFixed(2)}`);
    }
    const f = await t.fgLuma(p, '#card');
    t.known('text-gray-900 (oklch token) is light', f > 0.55, 'oklch values are not parsed', `luma ${f.toFixed(2)}`);
  });

  // shadcn/ui: space-separated HSL channels wrapped in hsl(var(--x)).
  const shadcn = page(
    'shadcn',
    `:root{--background:0 0% 100%;--foreground:222.2 84% 4.9%;--card:0 0% 100%;--muted:210 40% 96.1%;--border:214.3 31.8% 91.4%}
     body{background-color:hsl(var(--background));color:hsl(var(--foreground))}
     .card{background-color:hsl(var(--card));color:hsl(var(--foreground));border:1px solid hsl(var(--border));padding:12px}
     .muted{background-color:hsl(var(--muted));padding:12px}`,
    `<div class="card" id="card">card</div><div class="muted" id="muted">muted</div>`,
  );
  scenario('shadcn/ui: hsl(var(--background)) with "0 0% 100%" channels', async (t) => {
    const p = await t.open(shadcn, { settings: RECOLOR });
    for (const sel of ['body', '#card', '#muted']) {
      const l = await t.bgLuma(p, sel);
      t.known(`${sel.replace('#', '')} (hsl channel variable) is dark`, l < 0.3,
        'rewriteChannelTriplet() only understands "r g b" triplets, not "h s% l%"', `luma ${l.toFixed(2)}`);
    }
  });

  // Bootstrap 5: *-rgb triplets and !important utilities.
  const bootstrap = page(
    'bootstrap',
    `:root{--bs-body-bg:#fff;--bs-body-bg-rgb:255,255,255;--bs-body-color:#212529;--bs-white-rgb:255,255,255;--bs-light-rgb:248,249,250;--bs-border-color:#dee2e6;--bs-secondary-bg:#e9ecef;--bs-secondary-bg-rgb:233,236,239;--bs-bg-opacity:1}
     body{background-color:var(--bs-body-bg);color:var(--bs-body-color)}
     .bg-white{--bs-bg-opacity:1;background-color:rgba(var(--bs-white-rgb),var(--bs-bg-opacity))!important}
     .bg-light{--bs-bg-opacity:1;background-color:rgba(var(--bs-light-rgb),var(--bs-bg-opacity))!important}
     .card{background-color:var(--bs-body-bg);border:1px solid var(--bs-border-color);padding:12px}
     .bg-body-secondary{background-color:rgba(var(--bs-secondary-bg-rgb),var(--bs-bg-opacity))!important;padding:12px}`,
    `<div class="card" id="card">card</div><div class="bg-white p-3" id="white">bg-white</div><div class="bg-light p-3" id="light">bg-light</div><div class="bg-body-secondary" id="secondary">secondary</div>`,
  );
  scenario('Bootstrap 5: --bs-*-rgb triplets and !important utilities', async (t) => {
    const p = await t.open(bootstrap, { settings: RECOLOR });
    for (const [sel, label] of [['#card', '.card'], ['#white', '.bg-white !important'], ['#light', '.bg-light !important'], ['#secondary', '.bg-body-secondary']]) {
      await expectDark(t, p, sel, label);
    }
    await expectLightText(t, p, '#card', '.card');
  });

  // GitHub Primer style: undefined primary var, fallback chain.
  const primer = page(
    'primer',
    `.Box{background:var(--bgColor-default,var(--color-canvas-default,#fff));color:var(--fgColor-default,var(--color-fg-default,#1f2328));
       border:1px solid var(--borderColor-default,var(--color-border-default,#d0d7de));padding:12px}
     .Box--subtle{background:var(--bgColor-muted,var(--color-canvas-subtle,#f6f8fa));padding:12px}`,
    `<div class="Box" id="box">box</div><div class="Box--subtle" id="subtle">subtle</div>`,
  );
  scenario('Primer-style var() fallback chains', async (t) => {
    const p = await t.open(primer, { settings: RECOLOR });
    await expectDark(t, p, '#box', 'var(--a, var(--b, #fff))');
    await expectDark(t, p, '#subtle', 'var(--a, var(--b, #f6f8fa))');
    await expectLightText(t, p, '#box', 'var chain text');
  });

  // Material 3 tokens + alias chains + one variable used as bg AND fg.
  const m3 = page(
    'm3',
    `:root{--md-sys-color-surface:#fef7ff;--md-sys-color-on-surface:#1d1b20;--md-sys-color-primary:#6750a4;--md-sys-color-on-primary:#fff;
       --palette-neutral:#fff;--surface:var(--palette-neutral);--panel:var(--surface);--ink:#111}
     body{background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface)}
     .btn{background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary);padding:10px;display:inline-block}
     .panel{background:var(--panel);padding:12px}
     .ink-bg{background:var(--ink);color:#fff;padding:12px}
     .ink-fg{color:var(--ink);padding:12px}`,
    `<div class="btn" id="btn">filled</div><div class="panel" id="alias">alias chain</div><div class="ink-bg" id="ink-bg">var as background</div><div class="ink-fg" id="ink-fg">var as text</div>`,
  );
  scenario('Material 3 tokens, alias chains, variable reused as bg and fg', async (t) => {
    const p = await t.open(m3, { settings: RECOLOR });
    await expectDark(t, p, 'body', 'surface token');
    await expectDark(t, p, '#alias', '--panel → --surface → --palette-neutral');
    await expectDark(t, p, '#ink-bg', '--ink used as background');
    await expectLightText(t, p, '#ink-fg', '--ink used as text');
    const c = await t.call(p, 'contrastOf', '#btn');
    t.check('primary button label legible', c >= 3, `contrast ${c.toFixed(1)}`);
  });

  // Theme variables swapped at runtime by script (next-themes/chakra/style engines).
  const runtime = page(
    'runtime-vars',
    `.c{background:var(--bg);color:var(--fg);padding:12px}`,
    `<div class="c" id="c">runtime theme</div>`,
    `<script>document.documentElement.style.setProperty('--bg', '#ffffff'); document.documentElement.style.setProperty('--fg', '#111111');</script>`,
  );
  scenario('theme variables set from JS on <html style>', async (t) => {
    const p = await t.open(runtime, { settings: RECOLOR });
    const l = await t.bgLuma(p, '#c');
    t.known('var(--bg) set via documentElement.style.setProperty is dark', l < 0.3,
      'inline custom properties are never rewritten, and the rule cannot be derived from them', `luma ${l.toFixed(2)}`);
  });

  // Variables that only exist in a theme scope.
  const scoped = page(
    'scoped-vars',
    `:root,[data-theme=light]{--bg:#fff;--fg:#111}
     [data-theme=dark]{--bg:#000;--fg:#fff}
     @media (min-width:600px){:root{--accent:#f0f0f0}}
     .c{background:var(--bg);color:var(--fg);padding:12px}
     .a{background:var(--accent);padding:12px;color:#111}`,
    `<div class="c" id="c">scoped</div><div class="a" id="accent">accent in media</div>`,
  );
  scenario('variables defined under [data-theme] and @media', async (t) => {
    const p = await t.open(scoped, { settings: RECOLOR });
    await expectDark(t, p, '#c', '--bg from :root,[data-theme=light]');
    await expectDark(t, p, '#accent', '--accent defined inside @media');
  });

  // Whole design system in one go.
  const SITE_CSS = `
    :root{--bg:#fff;--surface:#f8f9fa;--text:#212529;--muted:#6c757d;--border:#dee2e6;--link:#0d6efd}
    *{box-sizing:border-box}
    body{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--text)}
    header.nav{position:sticky;top:0;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;gap:16px}
    header.nav a{color:var(--text);text-decoration:none}
    main{max-width:780px;margin:0 auto;padding:24px}
    h1,h2{color:#111}
    a{color:var(--link)}
    .muted{color:var(--muted)}
    .card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin:16px 0}
    .btn{display:inline-block;border:0;border-radius:6px;padding:8px 14px;color:#fff;background:#0d6efd}
    .btn-light{background:#f8f9fa;color:#212529;border:1px solid #ced4da}
    .badge{display:inline-block;padding:2px 8px;border-radius:10px;color:#fff;background:#198754;font-size:12px}
    .alert{background:#fff3cd;color:#664d03;border:1px solid #ffecb5;padding:12px;border-radius:6px}
    .danger{color:#dc3545}
    input,textarea,select{background:#fff;color:#212529;border:1px solid #ced4da;border-radius:4px;padding:6px 10px;font:inherit}
    table{border-collapse:collapse;width:100%}
    th,td{border-bottom:1px solid #dee2e6;padding:8px;text-align:left}
    tbody tr:nth-child(even){background:#f8f9fa}
    code,pre{background:#f6f8fa;color:#24292f;border-radius:6px}
    pre{padding:12px;overflow:auto}
    blockquote{border-left:4px solid #dee2e6;margin:0;padding:0 16px;color:#6c757d}
    footer{background:#f8f9fa;color:#6c757d;padding:24px;text-align:center;margin-top:40px}
    mark{background:#fff3a3;color:#111}
    .hero{background:linear-gradient(135deg,#fff,#e9ecef);padding:48px 24px;text-align:center}
    .btn:hover{background:#0b5ed7}.btn-light:hover{background:#e2e6ea}
    tbody tr:hover{background:#eef3ff}
    .tab{padding:8px 12px;border-bottom:2px solid transparent}.tab.active{border-bottom-color:#0d6efd;color:#0d6efd}
    details{border:1px solid #dee2e6;padding:8px;border-radius:6px}
    dialog{background:#fff;color:#111;border:1px solid #ccc}
    dialog::backdrop{background:rgba(0,0,0,.4)}
    progress{accent-color:#0d6efd}
  `;
  const SITE_BODY = `
    <header class="nav"><strong>Acme</strong><a href="#">Docs</a><a href="#">Pricing</a><a href="#">Blog</a></header>
    <div class="hero" id="hero"><h1>Build faster</h1><p class="muted">A light-only marketing page</p><a class="btn" id="btn" href="#">Get started</a> <button class="btn btn-light" id="btn-light">Learn more</button></div>
    <main>
      <h2>Overview</h2>
      <p>Body text with a <a id="link" href="#">link</a>, <mark>highlight</mark>, <code id="inline-code">inline code</code> and <span class="badge" id="badge">new</span>.</p>
      <div class="card" id="card"><strong>Card title</strong><p class="muted" id="muted">Muted paragraph inside a card.</p></div>
      <div class="alert" id="alert">Warning: something needs attention.</div>
      <p class="danger" id="danger">Validation error text</p>
      <form><p><input id="input" placeholder="Email"> <select id="select"><option>One</option><option>Two</option></select></p>
        <p><textarea id="textarea">Notes</textarea></p><p><label><input type="checkbox" checked> Remember me</label> <label><input type="radio" checked> Option</label> <input type="range" id="range"> <progress id="progress" value="40" max="100"></progress></p></form>
      <div><span class="tab active">Overview</span><span class="tab">Specs</span></div>
      <table id="table"><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Ada</td><td>Eng</td></tr><tr id="row2"><td>Grace</td><td>Admiral</td></tr><tr><td>Linus</td><td>Kernel</td></tr></tbody></table>
      <pre id="pre">const answer = 42;</pre>
      <blockquote id="quote">A quoted remark.</blockquote>
      <details open><summary>More</summary>Hidden details</details>
      <dialog id="dialog" open><p>Dialog content</p></dialog>
    </main>
    <footer id="footer">© Acme Inc.</footer>`;
  server.add('/fw/site.html', doc(SITE_BODY, { style: SITE_CSS }));

  scenario('kitchen-sink light design system: whole-page darkness and legibility', async (t) => {
    const p = await t.open('/fw/site.html', { settings: RECOLOR, viewport: { width: 1000, height: 1400 } });
    const shot = await t.shot(p, 'kitchen-sink-recolor');
    t.check('screenshot is predominantly dark', shot.mean < 0.3, `mean luma ${shot.mean.toFixed(2)}`);
    t.check('almost no bright pixels remain', shot.bright < 0.03, `${(shot.bright * 100).toFixed(1)}% bright`);

    const scan = await t.call(p, 'textScan', { viewportOnly: false });
    t.check('text legibility: < 2% of characters below 3:1', scan.lowFrac < 0.02,
      `${(scan.lowFrac * 100).toFixed(1)}% — ${JSON.stringify(scan.offenders.slice(0, 3))}`);

    for (const [sel, label] of [
      ['#card', 'card'], ['#alert', 'alert'], ['#input', 'input'], ['#select', 'select'], ['#textarea', 'textarea'],
      ['#pre', 'pre'], ['#footer', 'footer'], ['#inline-code', 'inline code'], ['#dialog', '<dialog>'], ['#btn-light', 'light button'],
    ]) {
      await expectDark(t, p, sel, label);
    }
    t.check('table zebra row is dark', (await t.bgLuma(p, '#row2')) < 0.3);
    await expectDark(t, p, '#hero', 'gradient hero (computed bg colour)', 0.3).catch(() => {});

    const glare = await t.call(p, 'lightBorders', 0.7);
    t.known('no near-white borders remain (header, table rows, details…)', glare.length === 0,
      '`border-bottom: 1px solid #dee2e6` style shorthands are never rewritten', `${glare.length}: ${glare.slice(0, 6).join(', ')}`);

    // Brand/status colours must stay recognisably coloured.
    await t.lib(p);
    const btn = await p.evaluate(() => __t.bgRgb('#btn'));
    t.check('primary button stays blue', btn[2] > btn[0] + 40, btn.join(','));
    const badge = await p.evaluate(() => __t.bgRgb('#badge'));
    t.check('success badge stays green', badge[1] > badge[0] + 20, badge.join(','));
    const danger = await p.evaluate(() => __t.fgLuma('#danger'));
    t.check('error text stays legible on dark', (await t.call(p, 'contrastOf', '#danger')) >= 3);

    // Hover states must not flash back to light.
    await p.hover('#btn-light');
    await sleep(200);
    await expectDark(t, p, '#btn-light', 'hovered light button');
    await p.hover('#row2');
    await sleep(200);
    await expectDark(t, p, '#row2', 'hovered table row');
  });

  scenario('kitchen-sink: sticky translucent header with backdrop blur', async (t) => {
    const p = await t.open('/fw/site.html', { settings: RECOLOR, viewport: { width: 1000, height: 700 } });
    await expectDark(t, p, 'header.nav', 'rgba(255,255,255,.9) header');
    const c = await t.call(p, 'contrastOf', 'header.nav a');
    t.check('header links legible', c >= 3, `contrast ${c.toFixed(1)}`);
  });

  // The extension's own flash-guard <style> is a document stylesheet, so recolor
  // scans it and bakes `html{background-color:…!important}` into its override sheet.
  scenario('override sheet does not ingest the extension\'s own flash-guard style', async (t) => {
    server.add('/fw/plain-light.html', doc('<h1>Hi</h1>', { style: 'body{margin:0}' }));
    const p = await t.open('/fw/plain-light.html', { settings: RECOLOR, extra: 100 });
    const important = await p.evaluate(() =>
      document.adoptedStyleSheets.flatMap((s) => [...s.cssRules].map((r) => r.cssText)).filter((c) => /!important/.test(c)),
    );
    t.known('no !important rule in the override sheet for a page without any', important.length === 0,
      'the flash <style> (html{background-color:…!important}) is scanned like a page sheet and kept until the next re-scan',
      important.join(' | ').slice(0, 120));
  });

  // Page canvas: where the background lives matters for what the browser paints.
  const canvasVariants = {
    'html-only': 'html{background:#fff}',
    'body-only': 'body{background:#fff}',
    'both': 'html,body{background:#fff}',
    'html-named': 'html{background:white}',
    'body-min-height': 'body{background:#fafafa;min-height:100vh;margin:0}',
    'none': 'body{color:#222}',
  };
  for (const [name, css] of Object.entries(canvasVariants)) {
    server.add(`/fw/canvas-${name}.html`, doc('<h1>Hello</h1><p>content</p>', { style: css }));
  }
  scenario('page canvas: background on html, body, both, or neither paints dark', async (t) => {
    for (const name of Object.keys(canvasVariants)) {
      const p = await t.open(`/fw/canvas-${name}.html`, { settings: RECOLOR, viewport: { width: 900, height: 600 }, extra: 1500 });
      const shot = await t.shot(p, `canvas-${name}`, { points: [[880, 580], [450, 300]] });
      const ok = shot.at[0].luma < 0.3;
      const label = `canvas: ${name}`;
      if (name === 'html-named') t.known(label, ok, 'named colour white is not rewritten (see colors suite)', `corner luma ${shot.at[0].luma.toFixed(2)}`);
      else t.check(label, ok, `corner luma ${shot.at[0].luma.toFixed(2)}`);
      await p.close();
    }
  });
}
