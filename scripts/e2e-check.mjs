/* eslint-disable */
// Loads the built extension (.output/chrome-mv3) into Chrome and checks that
// the target page actually renders dark.
import puppeteer from 'puppeteer-core';
import { readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = process.argv[2] ?? 'https://en.wikipedia.org/wiki/Dark_mode';
const MODE = process.argv[3] ?? 'auto'; // off | auto | recolor | invert
const EXT = resolve('.output/chrome-mv3');

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

try {
  // Verify extension loaded (service worker can take a moment to spin up)
  let worker = null;
  for (let i = 0; i < 20 && !worker; i++) {
    await sleep(500);
    worker = browser.targets().find((t) => t.type() === 'service_worker');
  }
  console.log('extension worker:', worker ? 'loaded' : 'MISSING');
  if (!worker) {
    for (const t of browser.targets()) console.log('target:', t.type(), t.url());
  }

  const sw = await worker?.worker();
  const host = new globalThis.URL(URL).hostname;
  await sw?.evaluate(
    (h, m) => chrome.storage.local.set({ forceDarkSettings: { defaultMode: 'off', sites: { [h]: m } } }),
    host,
    MODE,
  );
  await sleep(500);

  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.setViewport({ width: 1280, height: 900 });
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('ForceDark')) console.log('[page console]', text);
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  // Give hydration + extension rescans time to work; tolerate the extension's
  // one-shot injection-recovery reload by re-acquiring the frame.
  await sleep(8000);

  const evaluateOnMain = async (fn) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const frame = page.frames().find((f) => f === page.mainFrame());
        return await frame.evaluate(fn);
      } catch (error) {
        if (attempt === 4) throw error;
        await sleep(3000);
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }).catch(() => {});
      }
    }
  };

  const result = await evaluateOnMain(() => {
    const status = null;
    const rootAttr = document.documentElement.getAttribute('data-force-dark');
    const overrideEl = document.getElementById('force-dark-overrides');
    const adopted = document.adoptedStyleSheets ?? [];
    const adoptedRules = adopted.reduce((n, s) => {
      try {
        return n + s.cssRules.length;
      } catch {
        return n;
      }
    }, 0);
    const filterEl = document.getElementById('force-dark-filter');
    const bodyStyle = getComputedStyle(document.body);
    const h1 = document.querySelector('h1, .entry-title, article h1');
    const h1Style = h1 ? getComputedStyle(h1) : null;
    const injected = document.documentElement.getAttribute('data-force-dark-injected');
    const inlineStyle = document.documentElement.getAttribute('style');
    return {
      rootAttr,
      injected,
      inlineStyle,
      overrideSheetBytes: overrideEl ? overrideEl.textContent.length : 0,
      adoptedSheets: adopted.length,
      adoptedRules,
      filterPresent: Boolean(filterEl),
      bodyBg: bodyStyle.backgroundColor,
      bodyColor: bodyStyle.color,
      h1Color: h1Style ? h1Style.color : null,
      title: document.title,
    };
  });
  console.log('STATE:', JSON.stringify(result, null, 2));

  mkdirSync('.test-shots', { recursive: true });
  await page.screenshot({ path: '.test-shots/site.png', fullPage: true });
  console.log('screenshot saved');
} finally {
  await browser.close();
}
