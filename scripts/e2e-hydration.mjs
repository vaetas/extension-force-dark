/* eslint-disable */
// Deterministic check: styles that arrive AFTER load (link insert + hydration
// via adoptedStyleSheets) must still end up dark.
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const EXT = resolve('.output/chrome-mv3');
const FIXTURE = resolve('scripts/fixtures/hydration');
const MIME = { '.html': 'text/html', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  try {
    const file = join(FIXTURE, req.url === '/' ? 'index.html' : '.' + req.url);
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404).end('nope');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
console.log('fixture at', base);

const userDataDir = resolve('.test-profile');
mkdirSync(userDataDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Chromium.app/Contents/MacOS/Chromium',
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
const snapshot = (f) =>
  f.evaluate(() => {
    const bg = (el) => getComputedStyle(el).backgroundColor;
    const color = (el) => getComputedStyle(el).color;
    return {
      attr: document.documentElement.getAttribute('data-force-dark'),
      bodyBg: bg(document.body),
      bodyFg: color(document.body),
      cardBg: bg(document.getElementById('card')),
      cardFg: color(document.getElementById('card')),
      overrides: document.getElementById('force-dark-overrides')?.textContent.length ?? 0,
      earlyStyleMarker: document.documentElement.getAttribute('style'),
    };
  });

try {
  for (let i = 0; i < 20 && !browser.targets().find((t) => t.type() === 'service_worker'); i++) {
    await sleep(500);
  }
  console.log('extension:', browser.targets().some((t) => t.type() === 'service_worker') ? 'loaded' : 'MISSING');

  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  await page.goto(base, { waitUntil: 'load', timeout: 30000 });

  await sleep(1000); // before late CSS arrives
  const early = await snapshot(page.mainFrame());
  console.log('EARLY  (t≈1s):', JSON.stringify(early));

  await sleep(5000); // late link (+1.5s) and hydration (+3s) have landed
  const late = await snapshot(page.mainFrame());
  console.log('LATE   (t≈6s):', JSON.stringify(late));

  mkdirSync('.test-shots', { recursive: true });
  await page.screenshot({ path: '.test-shots/hydration.png' });

  const fail = [];
  if (late.bodyBg === 'rgb(255, 255, 255)' && early.bodyBg === 'rgb(255, 255, 255)') {
    // body bg may legitimately change via late-theme.css; both must not stay white
    fail.push('body stayed white after late styles');
  }
  if (late.cardBg === 'rgb(244, 244, 244)' && late.cardBg === early.cardBg) {
    fail.push('card color never changed after hydration');
  }
  const dark = (c) => {
    const [r, g, b] = c.match(/\d+/g).map(Number);
    return r < 100 && g < 100 && b < 100;
  };
  const light = (c) => {
    const [r, g, b] = c.match(/\d+/g).map(Number);
    return r > 180 && g > 180 && b > 180;
  };
  if (!dark(late.bodyBg)) fail.push(`body bg not dark: ${late.bodyBg}`);
  if (!light(late.bodyFg)) fail.push(`body fg not light: ${late.bodyFg}`);
  if (!dark(late.cardBg)) fail.push(`card bg not dark: ${late.cardBg}`);
  if (!light(late.cardFg)) fail.push(`card fg not light: ${late.cardFg}`);

  console.log(fail.length ? 'FAIL: ' + fail.join('; ') : 'PASS: late styles are dark');
  process.exitCode = fail.length ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
