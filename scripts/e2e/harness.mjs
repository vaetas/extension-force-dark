/* eslint-disable */
// Shared plumbing for the browser e2e suites: a multi-host fixture server,
// Chromium launch with the built extension, service-worker helpers, in-page
// measurement helpers and a tiny scenario runner.
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIB_SOURCE } from './page-lib.mjs';

export const EXT = resolve('.output/chrome-mv3');
export const SHOTS = resolve('.test-shots');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

export function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error('No Chromium found; set CHROME_PATH');
  return found;
}

// ---------------------------------------------------------------------------
// Fixture server. Every `*.localhost` name resolves to loopback in Chromium, so
// one server gives us any number of distinct origins/hostnames without DNS.
// ---------------------------------------------------------------------------
export async function startServer() {
  const entries = new Map();
  const hits = [];

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    hits.push({ host: (req.headers.host ?? '').replace(/:\d+$/, ''), path: url.pathname });
    const entry = entries.get(url.pathname);
    if (!entry) return res.writeHead(404, { 'content-type': 'text/plain' }).end('nope');
    const o = typeof entry === 'function' ? await entry(req, url) : entry;
    const delay = Number(url.searchParams.get('delay') ?? o.delay ?? 0);
    if (delay) await sleep(delay);
    const headers = { 'content-type': o.type ?? 'text/html; charset=utf-8', ...(o.headers ?? {}) };
    res.writeHead(o.status ?? 200, headers);
    if (o.chunks) {
      for (const [data, wait] of o.chunks) {
        res.write(data);
        await sleep(wait ?? 0);
      }
      return res.end();
    }
    res.end(o.body ?? '');
  };
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  // Same port on ::1 so `http://[::1]:port` works (best effort).
  const v6 = createServer(handler);
  const hasV6 = await new Promise((r) => {
    v6.once('error', () => r(false));
    v6.listen(port, '::1', () => r(true));
  });

  return {
    port,
    hits,
    /** Register a page/asset. `body` is a string/Buffer; `opts` sets type/status/headers/delay/chunks. */
    add(path, body, opts = {}) {
      entries.set(path, { body, ...opts });
      return path;
    },
    /** Register a handler `(req, url) => opts`. */
    route(path, fn) {
      entries.set(path, fn);
      return path;
    },
    url(path = '/', host = '127.0.0.1') {
      return `http://${host}:${port}${path}`;
    },
    hasV6,
    close: () => {
      server.close();
      if (hasV6) v6.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Settings builders
// ---------------------------------------------------------------------------
export const HOST = '127.0.0.1';
export const OFF = { defaultMode: 'off', sites: {}, darkenImages: false, imageSites: {} };
export const mode = (m, host = HOST, extra = {}) => ({
  defaultMode: 'off',
  sites: { [host]: m },
  darkenImages: false,
  imageSites: {},
  ...extra,
});

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
export async function launch({ profile = '.test-profile-suite' } = {}) {
  const userDataDir = resolve(profile);
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: process.env.HEADLESS ? true : false,
    userDataDir,
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--window-size=1280,1000',
    ],
  });
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker', {
    timeout: 20000,
  });
  const sw = await target.worker();
  return { browser, sw, userDataDir };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
export function createRunner({ browser, sw, server, grep, only }) {
  const scenarios = [];
  const totals = { pass: 0, fail: 0, xfail: 0, xpass: 0, skip: 0 };
  const failed = [];
  const xpassed = [];
  const known = [];
  let analyzer = null;

  const getSW = async () => {
    // The worker can be replaced (extension reload / idle shutdown); a dead handle can hang forever.
    const alive = await Promise.race([
      sw.evaluate(() => 1).then(() => true, () => false),
      sleep(2500).then(() => false),
    ]);
    if (alive) return sw;
    for (let i = 0; i < 40; i += 1) {
      const target = browser.targets().find((t) => t.type() === 'service_worker' && t.url().includes('background'));
      if (target) {
        const w = await target.worker().catch(() => null);
        if (w && (await Promise.race([w.evaluate(() => 1).then(() => true, () => false), sleep(1500).then(() => false)]))) {
          sw = w;
          return sw;
        }
      }
      await sleep(250);
    }
    throw new Error('extension service worker did not come back');
  };

  const api = {
    server,
    browser,
    getSW,
    sleep,

    async setSettings(settings) {
      const w = await getSW();
      await w.evaluate((s) => chrome.storage.local.set({ forceDarkSettings: s }), settings);
    },
    async clearSettings() {
      const w = await getSW();
      await w.evaluate(() => chrome.storage.local.remove('forceDarkSettings'));
    },
    /** Drop the MAIN-world scheme registration (the extension cannot, see modes suite). */
    async resetScheme() {
      const w = await getSW();
      await w.evaluate(async () => {
        try {
          await chrome.scripting.unregisterContentScripts({ ids: ['force-dark-scheme'] });
        } catch {}
      });
    },
    async rawStorage(value) {
      const w = await getSW();
      await w.evaluate((s) => chrome.storage.local.set({ forceDarkSettings: s }), value);
    },

    /** Status + badge for the tab showing `page`, as the background sees it. */
    async tabInfo(page) {
      const w = await getSW();
      const url = page.url();
      return w.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => t.url === u);
        if (!tab) return null;
        const key = `tabTheme:${tab.id}`;
        const state = (await chrome.storage.session.get(key))[key] ?? null;
        const badge = await chrome.action.getBadgeText({ tabId: tab.id });
        return { id: tab.id, status: state?.status ?? null, host: state?.host ?? null, badge };
      }, url);
    },
    async status(page) {
      return (await api.tabInfo(page))?.status ?? null;
    },
    /** Wait until the tab reports a non-pending status (or time out → last value). */
    async settled(page, { timeout = 12000, extra = 250 } = {}) {
      const end = Date.now() + timeout;
      let status = null;
      while (Date.now() < end) {
        status = await api.status(page).catch(() => null);
        if (status && status !== 'pending') break;
        await sleep(150);
      }
      await sleep(extra);
      return status;
    },

    /** Wait until the tab reports exactly `want` (string or array), else return the last status. */
    async waitStatus(page, want, timeout = 9000) {
      const wants = Array.isArray(want) ? want : [want];
      const end = Date.now() + timeout;
      let status = null;
      while (Date.now() < end) {
        status = await api.status(page).catch(() => null);
        if (wants.includes(status)) return status;
        await sleep(120);
      }
      return status;
    },
    /** Apply settings to an already-open page and wait for the resulting status. */
    async live(page, settings, want, timeout) {
      await api.setSettings(settings);
      const got = await api.waitStatus(page, want, timeout);
      await sleep(200);
      return got;
    },

    /**
     * Open a URL with settings applied first. Records console warnings from the
     * extension and uncaught page errors so scenarios can assert on them.
     */
    async open(urlOrPath, opts = {}) {
      const {
        settings = OFF,
        scheme = 'light',
        viewport = { width: 1000, height: 700 },
        wait = true,
        extra = 250,
        media,
        beforeGoto,
        waitUntil = 'load',
      } = opts;
      if (settings) await api.setSettings(settings);
      const page = await browser.newPage();
      await page.setViewport(viewport);
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      if (media) await page.emulateMediaType(media);
      page.__issues = [];
      page.on('console', (m) => {
        const text = m.text();
        if (text.includes('[ForceDark]')) page.__issues.push(text);
      });
      page.on('pageerror', (e) => page.__issues.push(`pageerror: ${e.message}`));
      if (beforeGoto) await beforeGoto(page);
      api.__pages.push(page);
      const url = urlOrPath.startsWith('http') ? urlOrPath : server.url(urlOrPath);
      await page.bringToFront().catch(() => {});
      await page.goto(url, { waitUntil, timeout: 45000 });
      if (wait && settings && settings !== OFF) await api.settled(page, { extra });
      else await sleep(extra);
      return page;
    },

    /** Install the in-page helper library once per document and call into it. */
    async lib(target) {
      const has = await target.evaluate(() => Boolean(window.__t)).catch(() => false);
      if (!has) await target.evaluate(LIB_SOURCE);
      return target;
    },
    async call(target, fn, ...args) {
      await api.lib(target);
      return target.evaluate((name, a) => window.__t[name](...a), fn, args);
    },

    /** Luma 0..1 of an element's effective background (ancestors composited). */
    rect: (page, sel) => api.call(page, 'rect', sel),
    bgLuma: (page, sel) => api.call(page, 'bgLuma', sel),
    fgLuma: (page, sel) => api.call(page, 'fgLuma', sel),

    /** Decode a screenshot in a throwaway tab and return luminance stats. */
    async shot(page, name, opts = {}) {
      mkdirSync(SHOTS, { recursive: true });
      const b64 = await page.screenshot({ encoding: 'base64', fullPage: false, ...opts });
      if (name) {
        const fs = await import('node:fs');
        const dir = `${SHOTS}/${opts.dir ?? 'suite'}`;
        mkdirSync(dir, { recursive: true });
        fs.writeFileSync(`${dir}/${name}.png`, Buffer.from(b64, 'base64'));
      }
      const result = await api.analyze(b64, opts.points ?? []);
      // The analyzer tab steals focus; a hidden page would stall input and the extension's poll.
      await page.bringToFront().catch(() => {});
      return result;
    },
    async analyze(b64, points = []) {
      if (!analyzer) {
        analyzer = await browser.newPage();
        await analyzer.goto('about:blank');
      }
      return analyzer.evaluate(
        async (data, pts) => {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
          const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const c = document.createElement('canvas');
          c.width = bmp.width;
          c.height = bmp.height;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(bmp, 0, 0);
          const px = x.getImageData(0, 0, c.width, c.height).data;
          const luma = (i) => (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
          let sum = 0;
          let bright = 0;
          let dark = 0;
          const n = c.width * c.height;
          for (let i = 0; i < n; i += 1) {
            const l = luma(i * 4);
            sum += l;
            if (l > 0.7) bright += 1;
            if (l < 0.25) dark += 1;
          }
          const at = pts.map(([px0, py0]) => {
            const i = (Math.round(py0) * c.width + Math.round(px0)) * 4;
            return { r: px[i], g: px[i + 1], b: px[i + 2], luma: luma(i) };
          });
          return { width: c.width, height: c.height, mean: sum / n, bright: bright / n, dark: dark / n, at };
        },
        b64,
        points,
      );
    },

    __pages: [],
    async closePages() {
      for (const p of api.__pages.splice(0)) await p.close().catch(() => {});
    },
  };

  // ---- scenario authoring --------------------------------------------------
  function scenario(name, fn, opts = {}) {
    scenarios.push({ name, fn, ...opts });
  }

  async function run() {
    const selected = scenarios.filter((s) => {
      if (only && !only.includes(s.suite)) return false;
      return !grep || s.name.toLowerCase().includes(grep.toLowerCase());
    });
    for (const sc of selected) {
      console.log(`\n▸ ${sc.name}`);
      const local = { fail: 0 };
      const t = {
        ...api,
        check(label, ok, detail = '') {
          if (ok) {
            totals.pass += 1;
            console.log(`  PASS  ${label}`);
          } else {
            totals.fail += 1;
            local.fail += 1;
            failed.push(`${sc.name} › ${label}`);
            console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
          }
          return ok;
        },
        /** A documented gap in the extension: failing is expected, passing is news. */
        known(label, ok, reason, detail = '') {
          if (ok) {
            totals.xpass += 1;
            xpassed.push(`${sc.name} › ${label}`);
            console.log(`  XPASS ${label}  — known gap now passes; remove the marker`);
          } else {
            totals.xfail += 1;
            known.push({ where: `${sc.name} › ${label}`, reason, detail });
            console.log(`  XFAIL ${label}  — ${reason}${detail ? ' [' + detail + ']' : ''}`);
          }
        },
        skip(label, why) {
          totals.skip += 1;
          console.log(`  SKIP  ${label}  — ${why}`);
        },
        note(msg) {
          console.log(`  note  ${msg}`);
        },
      };
      try {
        await Promise.race([
          sc.fn(t),
          new Promise((_, rej) => setTimeout(() => rej(new Error('scenario timeout')), sc.timeout ?? 90000)),
        ]);
        // Every page opened by the scenario must be free of extension warnings/errors.
        if (!sc.allowIssues) {
          const issues = api.__pages.flatMap((p) => p.__issues ?? []);
          t.check('no extension warnings / page errors', issues.length === 0, issues.slice(0, 3).join(' | '));
        }
      } catch (error) {
        totals.fail += 1;
        failed.push(`${sc.name} › exception`);
        console.log(`  FAIL  exception: ${error?.stack ?? error}`);
      } finally {
        await api.setSettings(OFF).catch(() => {});
        await sleep(150);
        await api.resetScheme().catch(() => {});
        await api.closePages();
      }
    }
    return { totals, failed, xpassed, known };
  }

  return { scenario, run, api };
}
