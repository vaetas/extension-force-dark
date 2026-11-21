/* eslint-disable */
// The mode state machine: transitions, revert purity, races, isolation, settings.
import { mode, OFF, HOST, sleep } from '../harness.mjs';
import { doc } from './_util.mjs';

const PAGE_CSS = `body{background:#fff;color:#222;font-family:sans-serif}.card{background:#f4f4f4;border-color:#ccc;border-style:solid;border-width:1px;padding:12px}`;

export default function register({ scenario, server }) {
  server.add('/modes/page.html', doc(`<h1>Mode page</h1><div class="card" id="card">Card</div><input id="field" value="x">`, { style: PAGE_CSS }));

  const settingsFor = (m, host = HOST) => (m === 'off' ? OFF : mode(m, host));
  const STATUS = { off: ['off', null], recolor: 'recolor', invert: 'invert', auto: 'recolor' };

  async function snapshot(t, page) {
    return page.evaluate(() => {
      const root = document.documentElement;
      return {
        attr: root.getAttribute('data-force-dark'),
        filter: getComputedStyle(root).filter,
        adopted: document.adoptedStyleSheets.length,
        invertStyle: !!document.getElementById('force-dark-invert'),
        flash: !!document.getElementById('force-dark-flash'),
      };
    });
  }

  async function expectState(t, page, m, label) {
    await t.lib(page);
    const s = await snapshot(t, page);
    const card = await t.bgLuma(page, '#card');
    const ok = {
      off: s.attr === null && s.filter === 'none' && s.adopted === 0 && !s.invertStyle && card > 0.8,
      recolor: s.attr === 'recolor' && s.filter === 'none' && s.adopted === 1 && !s.invertStyle && card < 0.3,
      invert: s.attr === 'invert' && /invert/.test(s.filter) && s.adopted === 0 && s.invertStyle,
      auto: s.attr === 'recolor' && s.filter === 'none' && s.adopted === 1 && card < 0.3,
    }[m];
    t.check(label, ok, JSON.stringify({ ...s, card: card.toFixed(2) }));
  }

  scenario('every live mode → mode transition ends in a clean, correct state', async (t) => {
    const modes = ['off', 'recolor', 'invert', 'auto'];
    const page = await t.open('/modes/page.html', { settings: OFF });
    for (const from of modes) {
      for (const to of modes) {
        if (from === to) continue;
        await t.live(page, settingsFor(from), STATUS[from]);
        await t.live(page, settingsFor(to), STATUS[to]);
        await expectState(t, page, to, `${from} → ${to}`);
      }
    }
  });

  // ---- revert purity -----------------------------------------------------------
  server.add(
    '/modes/rich.html',
    doc(
      `<h1 style="color:#111;background:#fff !important">Title</h1>
       <div class="card" id="card" style="border-color:#abc">Card</div>
       <form><input id="field" value="x" style="background:#fff;color:#000"><select><option>a</option></select></form>
       <div id="host"></div><svg width="20" height="20"><rect width="20" height="20" style="fill:#222"/></svg>
       <script>const sr=document.getElementById('host').attachShadow({mode:'open'});sr.innerHTML='<style>p{background:#fff}</style><p>shadow</p>'</script>`,
      { style: PAGE_CSS },
    ),
  );
  for (const m of ['recolor', 'invert', 'auto']) {
    scenario(`turning ${m} off restores the document exactly (DOM fingerprint, inline styles, leftovers)`, async (t) => {
      const page = await t.open('/modes/rich.html', { settings: OFF });
      await t.lib(page);
      const before = await page.evaluate(() => __t.fingerprint());
      await t.live(page, settingsFor(m), STATUS[m]);
      const during = await page.evaluate(() => __t.fingerprint());
      t.check(`${m} actually changed the page`, during !== before);
      await t.live(page, OFF, STATUS.off);
      await sleep(500);
      const after = await page.evaluate(() => __t.fingerprint());
      t.check('fingerprint identical to the pristine page', after === before,
        after === before ? '' : firstDiff(before, after));
      const left = await t.call(page, 'leftovers');
      t.check('no extension artifacts remain', left.length === 0, left.join(', '));
      const inline = await page.$eval('h1', (el) => el.getAttribute('style'));
      t.check('inline style attribute restored verbatim', /color:\s*#111|rgb\(17, 17, 17\)/.test(inline) && /important/.test(inline), String(inline));
    });
  }

  // ---- race: mode storm ------------------------------------------------------------
  scenario('rapid mode changes converge to the last write and leak nothing', async (t) => {
    const page = await t.open('/modes/page.html', { settings: OFF });
    const seq = ['recolor', 'invert', 'auto', 'off', 'invert', 'recolor', 'auto', 'invert', 'off', 'recolor'];
    for (let i = 0; i < 40; i += 1) {
      await t.setSettings(settingsFor(seq[i % seq.length]));
      await sleep(15);
    }
    await t.setSettings(settingsFor('recolor'));
    await t.waitStatus(page, 'recolor');
    await sleep(1500);
    const after = await snapshot(t, page);
    t.check('storm ending in recolor: recolored once, nothing else active',
      after.filter === 'none' && after.adopted === 1 && !after.invertStyle && !after.flash && (await t.bgLuma(page, '#card')) < 0.3, JSON.stringify(after));
    t.check('status reflects the last write', (await t.status(page)) === 'recolor');

    for (let i = 0; i < 30; i += 1) {
      await t.setSettings(settingsFor(['auto', 'invert', 'recolor'][i % 3]));
      await sleep(10);
    }
    await t.setSettings(OFF);
    await t.waitStatus(page, ['off']);
    await sleep(1500);
    await expectState(t, page, 'off', 'storm ending in off');
    const left = await t.call(page, 'leftovers');
    t.check('nothing leaked after the storm', left.length === 0, left.join(', '));
  });

  // ---- hostnames --------------------------------------------------------------------
  scenario('settings are per hostname: siblings, subdomains and the default behave', async (t) => {
    const hosts = ['a.localhost', 'b.localhost', 'www.a.localhost', HOST];
    const open = (h) => t.open(server.url('/modes/page.html', h), { settings: null, wait: false });
    await t.setSettings({ defaultMode: 'off', sites: { 'a.localhost': 'recolor' }, darkenImages: false, imageSites: {} });
    const pages = {};
    for (const h of hosts) pages[h] = await open(h);
    await t.waitStatus(pages['a.localhost'], 'recolor');
    await sleep(600);
    const dark = {};
    for (const h of hosts) dark[h] = (await t.bgLuma(pages[h], '#card')) < 0.3;
    t.check('a.localhost is recolored', dark['a.localhost']);
    t.check('b.localhost is untouched', !dark['b.localhost']);
    t.check('www.a.localhost (subdomain) is NOT matched by a.localhost', !dark['www.a.localhost']);
    t.check('127.0.0.1 is untouched', !dark[HOST]);

    await t.setSettings({ defaultMode: 'recolor', sites: { 'b.localhost': 'off' }, darkenImages: false, imageSites: {} });
    await sleep(2000);
    for (const h of hosts) dark[h] = (await t.bgLuma(pages[h], '#card')) < 0.3;
    t.check('default recolor reaches sites without an entry', dark['a.localhost'] && dark['www.a.localhost'] && dark[HOST], JSON.stringify(dark));
    t.check('explicit off beats the default', !dark['b.localhost']);
  });

  scenario('IPv6 literal host is themed (hosts with ":" cannot be pre-registered)', async (t) => {
    let url;
    if (!server.hasV6) return t.skip('IPv6', 'no ::1 on this machine');
    url = server.url('/modes/page.html', '[::1]');
    const page = await t.open(url, { settings: mode('recolor', '[::1]') });
    t.check('recolor works on [::1]', (await t.bgLuma(page, '#card')) < 0.3);
  });

  // ---- multi-tab ------------------------------------------------------------------------
  scenario('a setting change reaches every open tab of the site, and only that site', async (t) => {
    const a1 = await t.open('/modes/page.html?tab=1', { settings: OFF });
    const a2 = await t.open('/modes/page.html?tab=2', { settings: OFF });
    const other = await t.open(server.url('/modes/page.html?tab=3', 'other.localhost'), { settings: null, wait: false });
    await t.setSettings(mode('recolor'));
    await t.waitStatus(a1, 'recolor');
    await t.waitStatus(a2, 'recolor');
    await sleep(500);
    t.check('first tab recolored', (await t.bgLuma(a1, '#card')) < 0.3);
    t.check('second tab recolored', (await t.bgLuma(a2, '#card')) < 0.3);
    t.check('other host unaffected', (await t.bgLuma(other, '#card')) > 0.8);
    await t.setSettings(OFF);
    await sleep(1200);
    t.check('both tabs restored', (await t.bgLuma(a1, '#card')) > 0.8 && (await t.bgLuma(a2, '#card')) > 0.8);
  });

  // ---- badge / status ----------------------------------------------------------------------
  scenario('toolbar badge and per-tab status follow the mode', async (t) => {
    const page = await t.open('/modes/page.html', { settings: OFF });
    const info = async () => t.tabInfo(page);
    await t.live(page, mode('recolor'), 'recolor');
    await sleep(300);
    let i = await info();
    t.check('recolor → badge "ON"', i?.badge === 'ON', JSON.stringify(i));
    await t.live(page, mode('invert'), 'invert');
    await sleep(300);
    i = await info();
    t.check('invert → badge "ON"', i?.badge === 'ON', JSON.stringify(i));
    await t.live(page, OFF, ['off']);
    await sleep(300);
    i = await info();
    t.check('off → no badge', i?.badge === '', JSON.stringify(i));
    t.check('status host is the hostname', i?.host === HOST, JSON.stringify(i));
  });

  // ---- settings robustness -------------------------------------------------------------------
  scenario('corrupt or legacy stored settings never break the page', async (t) => {
    const origin = server.url('').replace(/\/$/, '');
    const cases = [
      ['string', 'garbage', false],
      ['null', null, false],
      ['number', 42, false],
      ['array', [1, 2], false],
      ['sites is a number', { sites: 5 }, false],
      ['unknown modes', { defaultMode: 'bogus', sites: { [HOST]: 'nope' } }, false],
      ['legacy enabledOrigins → auto', { enabledOrigins: [origin] }, true],
      ['legacy enabledForAll → auto', { enabledForAll: true }, true],
      ['legacy disabledOrigins beats enabledForAll', { enabledForAll: true, disabledOrigins: [origin] }, false],
      ['darkenImages garbage', { defaultMode: 'recolor', darkenImages: 'yes', imageSites: { [HOST]: 3 } }, true],
    ];
    for (const [label, value, shouldTheme] of cases) {
      await t.rawStorage(value);
      const page = await t.open('/modes/page.html', { settings: null, wait: false, extra: 400 });
      if (shouldTheme) await t.waitStatus(page, ['recolor', 'invert', 'native']);
      await sleep(400);
      const themed = (await t.bgLuma(page, '#card')) < 0.3;
      t.check(`${label}: ${shouldTheme ? 'themed' : 'left alone'}`, themed === shouldTheme, `themed=${themed}`);
      await page.close();
    }
  });

  // ---- a superseded Auto run must not clobber a newer mode ---------------------------------
  scenario('Auto superseded within its first 100 ms by another mode: the newer mode wins', async (t) => {
    for (const next of ['invert', 'recolor']) {
      const page = await t.open('/modes/page.html', { settings: OFF });
      await t.setSettings(settingsFor('auto'));
      await sleep(25);
      await t.setSettings(settingsFor(next));
      await t.waitStatus(page, next);
      await sleep(1800);
      const s = await snapshot(t, page);
      const want = next === 'invert' ? /invert/.test(s.filter) : s.adopted === 1 && s.filter === 'none';
      t.check(`auto → ${next} (25 ms apart) is effective`, want, JSON.stringify(s));
      if (next === 'invert') t.check('auto → invert: root marker says "invert"', s.attr === 'invert', `data-force-dark="${s.attr}"`);
      else t.known('auto → recolor: root marker says "recolor"', s.attr === 'recolor',
        'native-scheme apply() sets data-force-dark="native" after its awaits without checking it is still current', `data-force-dark="${s.attr}"`);
      await page.close();
    }
  });

  // ---- MAIN-world script registration ---------------------------------------------------------
  scenario('early matchMedia script: registered for Auto sites, updated and removed as settings change', async (t) => {
    const registered = async () => {
      const w = await t.getSW();
      return w.evaluate(async () => {
        const list = await chrome.scripting.getRegisteredContentScripts();
        const s = list.find((x) => x.id === 'force-dark-scheme');
        return s ? { matches: s.matches, exclude: s.excludeMatches ?? [], world: s.world } : null;
      });
    };
    const waitFor = async (pred) => {
      for (let i = 0; i < 20; i += 1) {
        const r = await registered();
        if (pred(r)) return r;
        await sleep(150);
      }
      return registered();
    };
    const mk = (defaultMode, sites) => ({ defaultMode, sites, darkenImages: false, imageSites: {} });
    const STUCK =
      "unregisterContentScripts({ids:['force-dark-scheme','force-dark-theme']}) rejects atomically because the legacy id was never registered, " +
      'so the script is never removed and the following registerContentScripts fails with a duplicate id';

    await t.resetScheme();
    await t.setSettings(mk('off', { 'x.localhost': 'auto', 'y.localhost': 'recolor', '[::1]': 'auto' }));
    let r = await waitFor((v) => v !== null);
    t.check('first registration: only Auto sites are matched (IPv6 literal skipped)',
      r && r.matches.length === 1 && r.matches[0] === '*://x.localhost/*', JSON.stringify(r));
    t.check('registered in the MAIN world', r?.world === 'MAIN');

    await t.setSettings(mk('off', { 'z.localhost': 'auto' }));
    r = await waitFor((v) => v && v.matches[0] === '*://z.localhost/*');
    t.known('changing the Auto site list updates the registration', r?.matches?.[0] === '*://z.localhost/*', STUCK, JSON.stringify(r));

    await t.setSettings(mk('recolor', {}));
    r = await waitFor((v) => v === null);
    t.known('registration is removed once no site uses Auto', r === null, STUCK, JSON.stringify(r));

    // Observable consequence: pages keep getting the MAIN-world patch.
    await t.resetScheme();
    await t.setSettings(mk('auto', {}));
    await waitFor((v) => v !== null);
    await t.setSettings(OFF);
    await sleep(600);
    const page = await t.open('/modes/page.html', { settings: null, wait: false, extra: 500 });
    const injected = await page.evaluate(() => window.__forceDarkScheme === true);
    t.known('after Auto is switched off, new pages no longer run the matchMedia patch', !injected, STUCK);

    const manifest = await (await t.getSW()).evaluate(() => chrome.runtime.getManifest().commands);
    t.check('toggle shortcut is declared (Alt+Shift+D)', manifest?.['toggle-site']?.suggested_key?.default === 'Alt+Shift+D', JSON.stringify(manifest));
  });
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return `…${a.slice(Math.max(0, i - 40), i + 80)}  ≠  …${b.slice(Math.max(0, i - 40), i + 80)}`;
}
