/* eslint-disable */
// Invert mode: media stays natural, hues survive, layout stays put, page can't easily kill it.
import { mode, OFF, sleep } from '../harness.mjs';
import { doc, pngBuffer, dataPng } from './_util.mjs';

export default function register({ scenario, server }) {
  const INVERT = mode('invert');
  server.add('/inv/red.png', pngBuffer('red', 40), { type: 'image/png' });
  const red = dataPng('red', 40);
  const black = dataPng('black', 40); // lightness discriminates re-inversion; hue-rotate(180) keeps hues either way
  const SIZE = 60;
  const cells = ['css-div', 'img', 'canvas', 'svg', 'inline-bg', 'class-bg', 'blue-div', 'picture', 'svg-image'];
  const MEDIA = ['img', 'canvas', 'inline-bg', 'class-bg', 'picture', 'svg-image'];
  server.add(
    '/inv/colors.html',
    doc(
      cells
        .map((id, i) => {
          const inner = {
            'css-div': '',
            img: `<img src="${black}" width="${SIZE}" height="${SIZE}">`,
            canvas: `<canvas width="${SIZE}" height="${SIZE}"></canvas>`,
            svg: `<svg width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="#dc1414"/></svg>`,
            'inline-bg': '',
            'class-bg': '',
            'blue-div': '',
            picture: `<picture><source media="(min-width:1px)" srcset="${black}"><img src="${black}" width="${SIZE}" height="${SIZE}"></picture>`,
            'svg-image': `<svg width="${SIZE}" height="${SIZE}"><image href="${black}" width="${SIZE}" height="${SIZE}"/></svg>`,
          }[id];
          const style = id === 'inline-bg' ? `background-image:url(${black});background-size:cover;` : '';
          return `<div class="cell" id="${id}" style="${style}">${inner}</div>`;
        })
        .join(''),
      {
        style: `body{background:#fff;margin:0;display:flex;flex-wrap:wrap;gap:20px;padding:20px}
          .cell{width:${SIZE}px;height:${SIZE}px}
          #css-div{background:#dc1414}
          #blue-div{background:#0d6efd}
          #class-bg{background-image:url(${black});background-size:cover}`,
        head: `<script>addEventListener('DOMContentLoaded',()=>{const c=document.querySelector('canvas');const x=c.getContext('2d');x.fillStyle='#111';x.fillRect(0,0,${SIZE},${SIZE});});</script>`,
      },
    ),
  );

  const px = async (t, page, ids) => {
    const pts = [];
    for (const id of ids) {
      const r = await t.rect(page, '#' + id);
      pts.push([r.x + r.w / 2, r.y + r.h / 2]);
    }
    return (await t.shot(page, 'invert-colors', { points: pts })).at;
  };
  const reddish = (c) => c.r > c.g + 50 && c.r > c.b + 50;

  scenario('invert: media keeps natural colours, brand hues survive the page filter', async (t) => {
    const page = await t.open('/inv/colors.html', { settings: INVERT });
    const at = await px(t, page, cells);
    const by = Object.fromEntries(cells.map((id, i) => [id, at[i]]));
    const show = (c) => `${c.r},${c.g},${c.b} (luma ${c.luma.toFixed(2)})`;
    t.check('page background is dark', (await t.shot(page, null, { points: [[5, 5]] })).at[0].luma < 0.35);
    t.check('red CSS block stays red (hue-rotate preserves hue)', reddish(by['css-div']), show(by['css-div']));
    t.check('red inline <svg> shape stays red', reddish(by.svg), show(by.svg));
    t.check('blue brand colour stays blue', by['blue-div'].b > by['blue-div'].r + 40, show(by['blue-div']));
    // A near-black image is light on screen unless it was re-inverted.
    for (const id of ['img', 'canvas', 'inline-bg', 'svg-image']) {
      t.check(`${id}: near-black media stays dark (re-inverted)`, by[id].luma < 0.3, show(by[id]));
    }
    t.known('<picture><img>: near-black media stays dark', by.picture.luma < 0.3,
      'both <picture> and its inner <img> match the re-invert selector, so the two filters cancel and the image shows as a negative', show(by.picture));
    t.known('background-image from a stylesheet class stays dark (re-inverted)', by['class-bg'].luma < 0.3,
      'only [style*="background-image"] is re-inverted; photos/sprites set in CSS classes come out as negatives', show(by['class-bg']));
  });

  server.add('/inv/scroll.html', doc(`<div id="fixed">fixed bar</div><div id="sticky">sticky</div><div style="height:3000px">tall</div><div id="end">end</div>`, {
    style: `body{margin:0;background:#fff}#fixed{position:fixed;top:0;left:0;right:0;height:30px;background:#eee;z-index:5}#sticky{position:sticky;top:30px;height:30px;background:#ddd}`,
  }));
  scenario('invert: filter on <html> does not break position:fixed / sticky after scrolling', async (t) => {
    const page = await t.open('/inv/scroll.html', { settings: INVERT });
    await page.evaluate(() => window.scrollTo(0, 1200));
    await sleep(300);
    const r = await page.evaluate(() => ({
      fixed: document.getElementById('fixed').getBoundingClientRect().top,
      sticky: document.getElementById('sticky').getBoundingClientRect().top,
      y: scrollY,
    }));
    t.check('fixed element stays at the viewport top', Math.abs(r.fixed) < 1, JSON.stringify(r));
    t.check('sticky element sticks', Math.abs(r.sticky - 30) < 1, JSON.stringify(r));
    t.check('page actually scrolled', r.y > 1000, JSON.stringify(r));
  });

  server.add('/inv/hostile.html', doc('<h1>hostile</h1><p>text</p>', { style: 'body{background:#fff}' }));
  scenario('invert: survives the page deleting the extension\'s style element or replacing <head>', async (t) => {
    const page = await t.open('/inv/hostile.html', { settings: INVERT });
    const filter = () => page.evaluate(() => getComputedStyle(document.documentElement).filter);
    t.check('precondition: inverted', /invert/.test(await filter()));
    await page.evaluate(() => document.getElementById('force-dark-invert').remove());
    await sleep(1600);
    t.check('style element restored by the keep-alive', /invert/.test(await filter()), await filter());
    await page.evaluate(() => { document.head.innerHTML = '<title>x</title>'; });
    await sleep(1600);
    t.check('restored after <head> replacement', /invert/.test(await filter()), await filter());
  });

  scenario('invert: page wiping <html> attributes', async (t) => {
    const page = await t.open('/inv/hostile.html', { settings: INVERT });
    await page.evaluate(() => { for (const a of [...document.documentElement.attributes]) document.documentElement.removeAttribute(a.name); });
    await sleep(2200);
    const f = await page.evaluate(() => getComputedStyle(document.documentElement).filter);
    t.known('inversion survives the root attribute being cleared', /invert/.test(f),
      'every invert rule is gated on html[data-force-dark="invert"] and only the <style> is kept alive, not the attribute', f);
  });

  scenario('print: dark mode must not leak onto paper', async (t) => {
    for (const m of ['recolor', 'invert']) {
      const page = await t.open('/inv/hostile.html', { settings: mode(m), media: 'print' });
      const r = await page.evaluate(() => ({
        filter: getComputedStyle(document.documentElement).filter,
        color: getComputedStyle(document.body).color,
      }));
      await t.lib(page);
      const textLuma = await page.evaluate(() => __t.fgLuma('body'));
      const ok = m === 'invert' ? !/invert/.test(r.filter) : textLuma < 0.5;
      t.known(`${m}: printed page keeps dark-on-white`, ok,
        m === 'invert' ? 'the invert rules are not scoped to @media screen' : 'the base layer (light body text #e8e6e3) is not scoped to @media screen',
        `filter ${r.filter}, text luma ${textLuma.toFixed(2)}`);
      await page.close();
    }
  });
}
