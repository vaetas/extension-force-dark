/* eslint-disable */
// Cost and stability: big pages, idle behaviour, busy pages.
import { mode, OFF, sleep } from '../harness.mjs';
import { doc } from './_util.mjs';

export default function register({ scenario, server }) {
  const RECOLOR = mode('recolor');
  const rules = Array.from({ length: 1500 }, (_, i) => `.c${i}{background:#${((i * 37) % 4096).toString(16).padStart(3, 'f').slice(-3)};color:#222;border-color:#ddd;border-width:1px;border-style:solid}`).join('\n');
  const nodes = Array.from({ length: 3000 }, (_, i) => `<div class="c${i % 1500}" ${i % 5 === 0 ? 'style="background:#fafafa;color:#111"' : ''}>row ${i}</div>`).join('');
  server.add('/perf/big.html', doc(`<div id="probe" class="c0">probe</div>${nodes}`, { style: `body{background:#fff}${rules}` }));

  scenario('large page (3000 nodes, 1500 rules, 600 inline styles): applies quickly, without long freezes', async (t) => {
    const page = await t.open('/perf/big.html', {
      settings: OFF,
      beforeGoto: (p) =>
        p.evaluateOnNewDocument(() => {
          window.__long = [];
          new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
        }),
    });
    await page.evaluate(() => (window.__long.length = 0));
    const t0 = Date.now();
    await t.setSettings(RECOLOR);
    await t.waitStatus(page, 'recolor', 20000);
    const ms = Date.now() - t0;
    await sleep(800);
    const long = await page.evaluate(() => window.__long);
    const worst = Math.max(0, ...long);
    t.note(`applied in ${ms} ms; long tasks: ${JSON.stringify(long)}`);
    t.check('ready within 5 s', ms < 5000, `${ms} ms`);
    t.check('no single main-thread task over 800 ms', worst < 800, `worst ${worst} ms`);
    t.check('page is dark', (await t.bgLuma(page, '#probe')) < 0.3);
    const t1 = Date.now();
    await t.setSettings(OFF);
    await t.waitStatus(page, ['off'], 10000);
    t.check('turning off is fast too (< 3 s)', Date.now() - t1 < 3000, `${Date.now() - t1} ms`);
  });

  server.add('/perf/idle.html', doc('<h1>idle</h1><div class="card" id="card" style="background:#fff;color:#111;padding:10px">idle</div>', { style: 'body{background:#fff}' }));
  scenario('an idle themed page stays idle: no DOM churn, no long tasks', async (t) => {
    for (const m of ['recolor', 'invert', 'auto']) {
      const page = await t.open('/perf/idle.html', {
        settings: mode(m),
        extra: 2500,
        beforeGoto: (p) => p.evaluateOnNewDocument(() => {
          window.__long = 0;
          new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__long += e.duration))).observe({ entryTypes: ['longtask'] });
        }),
      });
      await sleep(2500); // let auto's verification finish
      const result = await page.evaluate(() => new Promise((resolve) => {
        let n = 0;
        const mo = new MutationObserver((records) => { n += records.length; });
        mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        const before = window.__long;
        setTimeout(() => { mo.disconnect(); resolve({ mutations: n, long: window.__long - before }); }, 3000);
      }));
      t.check(`${m}: zero DOM mutations while idle for 3 s`, result.mutations === 0, JSON.stringify(result));
      t.check(`${m}: no long tasks while idle`, result.long < 100, JSON.stringify(result));
      await page.close();
    }
  });

  server.add('/perf/busy.html', doc('<div id="bar" style="height:20px;background:#fff;width:0"></div><div id="ticker" style="background:#fafafa;color:#111;padding:6px">0</div><p>animating</p>', {
    style: 'body{background:#fff}',
    head: `<script>
      window.__frames = 0; let n = 0;
      const tick = () => {
        n += 1; window.__frames += 1;
        const bar = document.getElementById('bar'); const tk = document.getElementById('ticker');
        if (bar) { bar.style.width = (n % 300) + 'px'; bar.style.background = n % 2 ? '#eee' : '#fff'; }
        if (tk) { tk.textContent = n; tk.style.background = 'hsl(0 0% ' + (90 + (n % 10)) + '%)'; }
        requestAnimationFrame(tick);
      };
      addEventListener('DOMContentLoaded', () => requestAnimationFrame(tick));
    </script>`,
  }));
  scenario('page that rewrites inline styles every frame does not starve the main thread', async (t) => {
    const frames = async (page) => {
      const a = await page.evaluate(() => window.__frames);
      await sleep(2000);
      return ((await page.evaluate(() => window.__frames)) - a) / 2;
    };
    const churn = (page) =>
      page.evaluate(() => new Promise((resolve) => {
        let c = 0; const mo = new MutationObserver((r) => { c += r.length; });
        mo.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
        const f0 = window.__frames;
        setTimeout(() => { mo.disconnect(); resolve({ mutations: c, frames: window.__frames - f0 }); }, 1500);
      }));
    const base = await t.open('/perf/busy.html', { settings: OFF, extra: 800 });
    const fpsOff = await frames(base);
    const baseChurn = await churn(base);
    await base.close();
    const on = await t.open('/perf/busy.html', { settings: RECOLOR, extra: 800 });
    const fpsOn = await frames(on);
    t.note(`frames/s: off ${fpsOff.toFixed(0)}, recolor ${fpsOn.toFixed(0)}`);
    t.check('recolor keeps ≥ 70% of the frame rate', fpsOn >= fpsOff * 0.7, `${fpsOn.toFixed(0)} vs ${fpsOff.toFixed(0)} fps`);
    t.check('still dark while animating', (await t.bgLuma(on, '#ticker')) < 0.3);
    const n = await churn(on);
    const perFrameOff = baseChurn.mutations / baseChurn.frames;
    const perFrameOn = n.mutations / n.frames;
    t.note(`DOM mutations per frame: page alone ${perFrameOff.toFixed(1)}, with recolor ${perFrameOn.toFixed(1)}`);
    t.check('extension at most ~2.5× the page\'s own style churn (no feedback loop)', perFrameOn <= perFrameOff * 2.5 + 1, `${perFrameOn.toFixed(1)} vs ${perFrameOff.toFixed(1)} per frame`);
  });
}
