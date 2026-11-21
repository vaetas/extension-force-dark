/* eslint-disable */
// Drives the real popup page; only the "which tab is active" lookup is stubbed.
import { mode, OFF, HOST, sleep } from '../harness.mjs';
import { doc } from './_util.mjs';

export default function register({ scenario, server }) {
  server.add('/popup/target.html', doc('<h1>target</h1><div id="card" style="background:#f4f4f4;padding:10px">card</div>', { style: 'body{background:#fff;color:#111}' }));

  async function openPopup(t, target, tabUrlOverride) {
    const info = await t.tabInfo(target);
    const w = await t.getSW();
    const extId = new URL(w.url()).host;
    const popup = await t.browser.newPage();
    t.__popups = [...(t.__popups ?? []), popup];
    await popup.evaluateOnNewDocument((tab) => {
      Object.defineProperty(chrome.tabs, 'query', { value: async () => [tab], configurable: true });
    }, { id: info?.id ?? 1, url: tabUrlOverride ?? target.url(), active: true });
    await popup.setViewport({ width: 360, height: 520 });
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await sleep(500);
    return popup;
  }
  const checked = (popup) => popup.$$eval('#modes button', (bs) => bs.find((b) => b.getAttribute('aria-checked') === 'true')?.dataset.mode ?? null);
  const click = async (popup, sel) => { await popup.click(sel); await sleep(250); };

  scenario('popup: pick a mode for the current site; status text follows', async (t) => {
    const target = await t.open('/popup/target.html', { settings: OFF });
    const popup = await openPopup(t, target);
    t.check('shows the hostname', (await popup.$eval('#host', (e) => e.textContent)) === HOST);
    t.check('Off is selected initially', (await checked(popup)) === 'off');
    t.check('status says Off', /Off/.test(await popup.$eval('#status', (e) => e.textContent)));

    await click(popup, '[data-mode="recolor"]');
    await t.waitStatus(target, 'recolor');
    await sleep(500);
    t.check('page was recolored by the popup click', (await t.bgLuma(target, '#card')) < 0.3);
    t.check('popup marks Recolor selected', (await checked(popup)) === 'recolor');
    t.check('popup status says recoloring', /Recoloring/i.test(await popup.$eval('#status', (e) => e.textContent)), await popup.$eval('#status', (e) => e.textContent));

    await click(popup, '[data-mode="invert"]');
    await t.waitStatus(target, 'invert');
    t.check('page inverted', /invert/.test(await target.evaluate(() => getComputedStyle(document.documentElement).filter)));
    t.check('status says inverting', /Inverting/i.test(await popup.$eval('#status', (e) => e.textContent)));

    await click(popup, '[data-mode="off"]');
    await t.waitStatus(target, ['off']);
    t.check('page restored', (await t.bgLuma(target, '#card')) > 0.8);
  });

  scenario('popup: per-site list, reset, default mode and image toggles write the right settings', async (t) => {
    const target = await t.open('/popup/target.html', { settings: OFF });
    const popup = await openPopup(t, target);
    const read = async () => (await (await t.getSW()).evaluate(async () => (await chrome.storage.local.get('forceDarkSettings')).forceDarkSettings));

    await click(popup, '[data-mode="recolor"]');
    await click(popup, '#images-site');
    let s = await read();
    t.check('site mode stored per hostname', s.sites?.[HOST] === 'recolor', JSON.stringify(s));
    t.check('site image toggle stored per hostname', s.imageSites?.[HOST] === true, JSON.stringify(s));
    t.check('"Sites with custom settings" lists the host', (await popup.$eval('#sites-count', (e) => e.textContent)) === '1');
    t.check('reset link appears', !(await popup.$eval('#reset', (e) => e.hidden)));

    await popup.select('#default-mode', 'invert');
    await sleep(300);
    s = await read();
    t.check('default mode stored', s.defaultMode === 'invert', JSON.stringify(s));
    t.check('site override still wins over the default', s.sites?.[HOST] === 'recolor');

    await click(popup, '#images-default');
    s = await read();
    t.check('default image toggle stored', s.darkenImages === true, JSON.stringify(s));

    await click(popup, '#reset');
    s = await read();
    t.check('reset removes both site overrides', !(HOST in (s.sites ?? {})) && !(HOST in (s.imageSites ?? {})), JSON.stringify(s));
    t.check('site now follows the new default (invert)', (await t.waitStatus(target, 'invert')) === 'invert');

    await click(popup, '[data-mode="auto"]');
    await popup.evaluate(() => document.getElementById('sites-details').open = true);
    await popup.click('#sites-list button');
    await sleep(400);
    s = await read();
    t.check('✕ in the list removes that site', !(HOST in (s.sites ?? {})), JSON.stringify(s));
  });

  scenario('popup: restricted pages cannot be themed', async (t) => {
    const target = await t.open('/popup/target.html', { settings: OFF });
    const popup = await openPopup(t, target, 'chrome://extensions/');
    const disabled = await popup.$$eval('#modes button', (bs) => bs.every((b) => b.disabled));
    t.check('mode buttons are disabled', disabled);
    t.check('explains why', /No changeable page/.test(await popup.$eval('#host', (e) => e.textContent)));
    const store = await openPopup(t, target, 'https://chromewebstore.google.com/detail/x');
    t.check('Chrome Web Store is treated as restricted', await store.$$eval('#modes button', (bs) => bs.every((b) => b.disabled)));
  });
}
