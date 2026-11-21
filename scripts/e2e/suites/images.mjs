/* eslint-disable */
// "Darken light images": what gets inverted, what must be left alone, and when.
import { mode, OFF, sleep } from '../harness.mjs';
import { doc, makePng } from './_util.mjs';

const ATTR = 'data-force-dark-img';

export default function register({ scenario, server }) {
  const IMG_ON = (m = 'recolor') => ({ ...mode(m), darkenImages: true });
  const png = (fn, size = 64) => makePng([0, 0, 0], size, fn);
  const art = {
    logo: png((x, y) => (x > 12 && x < 52 && y > 28 && y < 36 ? [17, 17, 17, 255] : [255, 255, 255, 255])),
    cutout: png((x, y) => (x > 16 && x < 48 && y > 16 && y < 48 ? [17, 17, 17, 255] : [0, 0, 0, 0])),
    whiteCutout: png((x, y) => (x > 16 && x < 48 && y > 16 && y < 48 ? [250, 250, 250, 255] : [0, 0, 0, 0])),
    darkBg: png((x, y) => (x > 12 && x < 52 && y > 28 && y < 36 ? [240, 240, 240, 255] : [20, 20, 20, 255])),
    photo: png((x, y) => [(x * 7 + y * 3) % 256, (x * 5 + y * 11) % 256, (x * 13 + y * 2) % 256, 255]),
    tiny: makePng([255, 255, 255], 4),
  };
  for (const [name, buf] of Object.entries(art)) server.add(`/img/${name}.png`, buf, { type: 'image/png' });
  server.add('/img/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#fff"/><rect x="12" y="28" width="40" height="8" fill="#111"/></svg>', { type: 'image/svg+xml' });
  server.add('/img/huge.png', makePng([255, 255, 255], 1700), { type: 'image/png' });

  const CDN = 'cdn.localhost';
  const verdicts = (page, ids) =>
    page.evaluate((list, attr) => Object.fromEntries(list.map((id) => [id, document.getElementById(id)?.getAttribute(attr) ?? null])), ids, ATTR);

  server.add('/img/kinds.html', doc(
    ['logo', 'cutout', 'whiteCutout', 'darkBg', 'photo', 'tiny'].map((n) => `<img id="${n}" src="/img/${n}.png" width="64" height="64">`).join('') +
    `<img id="svg" src="/img/logo.svg" width="64" height="64">
     <img id="huge" src="/img/huge.png" width="64" height="64">
     <img id="remote" src="${server.url('/img/logo.png', CDN)}" width="64" height="64">
     <img id="remotePhoto" src="${server.url('/img/photo.png', CDN)}" width="64" height="64">
     <img id="broken" src="/img/missing.png" width="64" height="64">
     <div id="cssbg" style="width:64px;height:64px;background:url(/img/logo.png)"></div>`,
    { style: 'body{background:#fff}' },
  ));

  scenario('classification: which images are inverted, which are left exactly alone', async (t) => {
    const page = await t.open('/img/kinds.html', { settings: IMG_ON(), extra: 3000 });
    const v = await verdicts(page, ['logo', 'cutout', 'whiteCutout', 'darkBg', 'photo', 'tiny', 'svg', 'huge', 'remote', 'remotePhoto', 'broken']);
    t.check('white logo with dark ink → bg', v.logo === 'bg', JSON.stringify(v));
    t.check('transparent cut-out with dark artwork → ink', v.cutout === 'ink', JSON.stringify(v));
    t.check('transparent cut-out with LIGHT artwork is left alone (already fine on dark)', v.whiteCutout === null, JSON.stringify(v));
    t.check('image with its own dark background is left alone', v.darkBg === null, JSON.stringify(v));
    t.check('photo is left alone', v.photo === null, JSON.stringify(v));
    t.check('image below the minimum size is left alone', v.tiny === null, JSON.stringify(v));
    t.check('image above the maximum size is left alone', v.huge === null, JSON.stringify(v));
    t.check('cross-origin logo (no CORS) is classified via the background', v.remote === 'bg', JSON.stringify(v));
    t.check('cross-origin photo is left alone', v.remotePhoto === null, JSON.stringify(v));
    t.check('broken image is ignored without errors', v.broken === null, JSON.stringify(v));
    t.check('SVG file used as <img> is classified', v.svg === 'bg', JSON.stringify(v.svg));
    const cssbg = await page.$eval('#cssbg', (el) => getComputedStyle(el).filter);
    t.check('CSS background-image is never touched', cssbg === 'none', cssbg);
    t.check('page pixels: inverted logo no longer a white slab', (await (async () => {
      const r = await t.rect(page, '#logo');
      return (await t.shot(page, 'images-kinds', { points: [[r.x + 4, r.y + 4]] })).at[0].luma;
    })()) < 0.45);
  });

  server.add('/img/lazy.html', doc(
    `<img id="top" src="/img/logo.png" width="64" height="64"><div style="height:3000px"></div><img id="far" loading="lazy" src="/img/logo.png?far" width="64" height="64">`,
    { style: 'body{background:#fff}' },
  ));
  scenario('lazy images far below the fold are classified only when they approach the viewport', async (t) => {
    const page = await t.open('/img/lazy.html', { settings: IMG_ON(), extra: 2000 });
    let v = await verdicts(page, ['top', 'far']);
    t.check('visible logo classified', v.top === 'bg', JSON.stringify(v));
    t.check('far image not yet classified (no wasted work)', v.far === null, JSON.stringify(v));
    await page.evaluate(() => window.scrollTo(0, 2800));
    await sleep(2500);
    v = await verdicts(page, ['far']);
    t.check('classified after scrolling near it', v.far === 'bg', JSON.stringify(v));
  });

  server.add('/img/dynamic.html', doc(
    `<img id="a" src="/img/logo.png" width="64" height="64"><img id="b" src="/img/photo.png" width="64" height="64">
     <picture><source media="(min-width: 1px)" srcset="/img/cutout.png"><img id="p" src="/img/photo.png" width="64" height="64"></picture>`,
    { style: 'body{background:#fff}' },
  ));
  scenario('swapped src, added images and <picture> sources are re-evaluated', async (t) => {
    const page = await t.open('/img/dynamic.html', { settings: IMG_ON(), extra: 2500 });
    let v = await verdicts(page, ['a', 'b', 'p']);
    t.check('initial: logo bg, photo skipped', v.a === 'bg' && v.b === null, JSON.stringify(v));
    t.check('<picture> source is what gets classified (currentSrc)', v.p === 'ink', JSON.stringify(v));
    await page.evaluate(() => {
      document.getElementById('a').src = '/img/photo.png';
      document.getElementById('b').src = '/img/logo.png?b';
      const n = new Image(); n.id = 'added'; n.width = 64; n.height = 64; n.src = '/img/logo.png?added'; document.body.appendChild(n);
    });
    await sleep(2500);
    v = await verdicts(page, ['a', 'b', 'added']);
    t.check('logo → photo: filter removed', v.a === null, JSON.stringify(v));
    t.check('photo → logo: filter added', v.b === 'bg', JSON.stringify(v));
    t.check('image added later is classified', v.added === 'bg', JSON.stringify(v));
  });

  server.add('/img/shadow.html', doc(`<div id="host"></div>`, {
    style: 'body{background:#fff}',
    head: `<script>addEventListener('DOMContentLoaded',()=>{const sr=document.getElementById('host').attachShadow({mode:'open'});sr.innerHTML='<img id="s" src="/img/logo.png" width="64" height="64">';});</script>`,
  }));
  scenario('images inside shadow roots', async (t) => {
    const page = await t.open('/img/shadow.html', { settings: IMG_ON(), extra: 2500 });
    const a = await page.evaluate((attr) => document.getElementById('host').shadowRoot.getElementById('s').getAttribute(attr), ATTR);
    t.known('light logo inside an open shadow root is darkened', a === 'bg',
      'querySelectorAll("img") and the MutationObserver do not pierce shadow roots', String(a));
  });

  server.add('/img/frame-inner.html', doc(`<img id="logo" src="${server.url('/img/logo.png', 'inner.localhost')}" width="64" height="64">`, { style: 'body{background:#fff}' }));
  server.add('/img/frame.html', doc(`<iframe id="f" src="${server.url('/img/frame-inner.html', 'inner.localhost')}" width="200" height="120"></iframe>`, { style: 'body{background:#fff}' }));
  scenario('images inside a cross-origin iframe follow the top site\'s setting', async (t) => {
    const page = await t.open(server.url('/img/frame.html', 'host-a.localhost'), { settings: { ...mode('recolor', 'host-a.localhost'), darkenImages: true }, extra: 3000 });
    const f = page.frames().find((x) => x.url().includes('frame-inner'));
    const a = f ? await f.evaluate((attr) => document.getElementById('logo').getAttribute(attr), ATTR) : 'no frame';
    t.check('logo inside the iframe is darkened', a === 'bg', String(a));
  });

  scenario('only while recolored: Invert, Auto→Invert and Off never leave image filters behind', async (t) => {
    const page = await t.open('/img/kinds.html', { settings: IMG_ON('recolor'), extra: 2500 });
    t.check('precondition: darkened under recolor', (await verdicts(page, ['logo'])).logo === 'bg');
    await t.live(page, IMG_ON('invert'), 'invert');
    await sleep(600);
    const v = await verdicts(page, ['logo', 'cutout']);
    const style = await page.evaluate(() => !!document.getElementById('force-dark-images'));
    t.check('invert mode: attributes removed', v.logo === null && v.cutout === null, JSON.stringify(v));
    t.check('invert mode: image stylesheet removed', !style);
    await t.live(page, IMG_ON('recolor'), 'recolor');
    await sleep(2500);
    t.check('back to recolor: darkened again without a reload', (await verdicts(page, ['logo'])).logo === 'bg');
  });

  // many images: queue + concurrency
  const many = Array.from({ length: 150 }, (_, i) => `<img id="m${i}" src="/img/logo.png?n=${i}" width="32" height="32">`).join('');
  server.add('/img/many.html', doc(many, { style: 'body{background:#fff}' }));
  scenario('150 images are processed without hanging the page', async (t) => {
    const page = await t.open('/img/many.html', { settings: IMG_ON(), extra: 500, viewport: { width: 1200, height: 3000 } });
    const t0 = Date.now();
    let done = 0;
    while (Date.now() - t0 < 20000) {
      done = await page.evaluate((attr) => document.querySelectorAll(`img[${attr}]`).length, ATTR);
      if (done >= 150) break;
      await sleep(500);
    }
    t.check('all 150 classified', done === 150, `${done}/150 after ${Math.round((Date.now() - t0) / 1000)}s`);
    const responsive = await Promise.race([page.evaluate(() => 'ok'), sleep(3000).then(() => 'stuck')]);
    t.check('page stays responsive', responsive === 'ok');
  });
}
