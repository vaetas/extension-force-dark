/* eslint-disable */
// Drives the built extension in Chromium: switches modes through storage on a
// loaded page (no reload) and checks the computed colors each time.
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

const EXT = resolve('.output/chrome-mv3');
const ROOT = resolve('scripts/fixtures');
const MIME = { '.html': 'text/html', '.css': 'text/css' };
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Chromium.app/Contents/MacOS/Chromium';

const server = createServer(async (req, res) => {
  try {
    const file = join(ROOT, '.' + req.url.split('?')[0]);
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404).end('nope');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const HOST = '127.0.0.1';

const userDataDir = resolve('.test-profile');
rmSync(userDataDir, { recursive: true, force: true });
mkdirSync(userDataDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`);
  if (!ok) failures.push(name);
};

const lum = (c) => {
  // A transparent body shows the (white) canvas.
  if (/rgba\(.*, 0\)$/.test(c)) return 1;
  const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

try {
  let worker;
  for (let i = 0; i < 30 && !worker; i++) {
    await sleep(500);
    worker = (await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 15000 }).catch(() => null));
  }
  if (!worker) throw new Error('extension service worker not found');
  const sw = await worker.worker();
  const setSettings = (settings) =>
    sw.evaluate((s) => chrome.storage.local.set({ forceDarkSettings: s }), settings);
  const readStatus = () =>
    sw.evaluate(async () => {
      const all = await chrome.storage.session.get(null);
      return Object.values(all).find((v) => v && v.status)?.status ?? null;
    });

  const snap = (page) =>
    page.evaluate(() => {
      const cs = (el) => getComputedStyle(el);
      const q = (s) => document.querySelector(s);
      return {
        attr: document.documentElement.getAttribute('data-force-dark'),
        bodyBg: cs(document.body).backgroundColor,
        bodyFg: cs(document.body).color,
        card: q('#card') ? cs(q('#card')).backgroundColor : null,
        chip: q('#chip') ? cs(q('#chip')).backgroundColor : null,
        hero: q('#hero') ? cs(q('#hero')).backgroundColor : null,
        filter: cs(document.documentElement).filter,
        input: q('input') ? cs(q('input')).backgroundColor : null,
      };
    });

  const open = async (path, settings) => {
    await setSettings(settings);
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 600 });
    // The machine running this may itself be in dark mode.
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.goto(base + path, { waitUntil: 'load' });
    await sleep(1500);
    return page;
  };
  const off = { defaultMode: 'off', sites: {} };

  // 1. Plain page: off -> recolor, live, then back to off.
  {
    const page = await open('/modes/plain.html', off);
    let s = await snap(page);
    check('plain: starts light when off', lum(s.bodyBg) > 0.9, s.bodyBg);
    await setSettings({ defaultMode: 'off', sites: { [HOST]: 'recolor' } });
    await sleep(1200);
    s = await snap(page);
    check('plain: recolor makes body dark live', lum(s.bodyBg) < 0.25, s.bodyBg);
    check('plain: recolor makes text light', lum(s.bodyFg) > 0.7, s.bodyFg);
    check('plain: recolor darkens form controls', s.input && lum(s.input) < 0.3, s.input);
    check('plain: status reported', (await readStatus()) === 'recolor', String(await readStatus()));
    await setSettings(off);
    await sleep(800);
    s = await snap(page);
    check('plain: off restores light', lum(s.bodyBg) > 0.9 && s.attr === null, JSON.stringify(s));
    await page.close();
  }

  // 2. Variables page: recolor handles var()/channel vars/url shorthand.
  {
    const page = await open('/modes/vars.html', { defaultMode: 'off', sites: { [HOST]: 'recolor' } });
    await sleep(800);
    const s = await snap(page);
    check('vars: body dark', lum(s.bodyBg) < 0.25, s.bodyBg);
    check('vars: card (var) dark', lum(s.card) < 0.3, s.card);
    check('vars: chip (rgb(var(--triplet))) dark', lum(s.chip) < 0.3, s.chip);
    check('vars: url shorthand colour dark', lum(s.hero) < 0.3, s.hero);
    check('vars: desktop ignores max-width media override', !/255, 0, 0/.test(s.bodyBg), s.bodyBg);
    await page.close();
  }

  // 3. Invert mode.
  {
    const page = await open('/modes/plain.html', { defaultMode: 'off', sites: { [HOST]: 'invert' } });
    const s = await snap(page);
    check('invert: filter applied', /invert/.test(s.filter), s.filter);
    check('invert: status', (await readStatus()) === 'invert', String(await readStatus()));
    await setSettings({ defaultMode: 'off', sites: { [HOST]: 'recolor' } });
    await sleep(1000);
    const s2 = await snap(page);
    check('invert -> recolor removes filter', s2.filter === 'none' && lum(s2.bodyBg) < 0.25, JSON.stringify(s2));
    await page.close();
  }

  // 4. Auto: site with its own dark theme uses it; plain page falls to recolor.
  {
    const page = await open('/modes/scheme.html', { defaultMode: 'off', sites: { [HOST]: 'auto' } });
    await sleep(1500);
    let s = await snap(page);
    check('auto: uses native dark theme', lum(s.bodyBg) < 0.15 && s.attr === 'native', JSON.stringify(s));
    await setSettings(off);
    await sleep(800);
    s = await snap(page);
    check('auto->off restores the site light theme', lum(s.bodyBg) > 0.9, s.bodyBg);
    await page.close();

    const plain = await open('/modes/plain.html', { defaultMode: 'auto', sites: {} });
    await sleep(2500);
    s = await snap(plain);
    // Unstyled pages go dark through color-scheme alone (transparent body, light text).
    check('auto: plain page ends dark (default mode)', lum(s.bodyBg) < 0.25 || lum(s.bodyFg) > 0.7 || /invert/.test(s.filter), JSON.stringify(s));
    await plain.close();
  }

  // 5. Hydration fixture still works in recolor mode.
  {
    const page = await open('/hydration/index.html', { defaultMode: 'off', sites: { [HOST]: 'recolor' } });
    await sleep(6000);
    const s = await page.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      card: getComputedStyle(document.getElementById('card')).backgroundColor,
    }));
    check('hydration: body dark after late styles', lum(s.bg) < 0.25, s.bg);
    check('hydration: card dark after late styles', lum(s.card) < 0.3, s.card);
    mkdirSync('.test-shots', { recursive: true });
    await page.screenshot({ path: '.test-shots/hydration.png' });
    await page.close();
  }
} catch (error) {
  console.error(error);
  failures.push('exception');
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
process.exit(failures.length ? 1 : 0);
