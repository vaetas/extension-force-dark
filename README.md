# Force Dark

A WXT + TypeScript browser extension that forces a dark theme on the site you're viewing — even when the site doesn't support dark mode.

## Using it

Click the toolbar icon and pick a mode for the **current site**. It applies instantly (no reload) and is remembered per hostname.

| Mode | What it does |
| --- | --- |
| **Off** | Leave the site alone. |
| **Auto** | Use the site's own dark theme if it has one (forces `prefers-color-scheme: dark`); otherwise recolor; if the page still looks light, fall back to invert. |
| **Recolor** | Rewrite the page's CSS colors (including `var()`/custom properties, inline styles, shadow DOM) into a dark palette, plus a dark base layer for anything left to browser defaults. |
| **Invert** | CSS `invert + hue-rotate` on the page, re-inverting images/video. Crude but works on anything. |

- **Default for other sites** (popup) is `Off` out of the box; set it to `Auto` to theme everything.
- **Sites with custom settings** lists overrides; ✕ resets a site to the default.
- **Alt+Shift+D** toggles the current site off / back to its last mode (rebind at `chrome://extensions/shortcuts`).
- The badge shows `ON` when a tab is themed.

## How it works

- `entrypoints/theme.content.ts` (isolated world, every page) reads settings, runs the pipeline for the site's mode and re-runs it live on `storage.onChanged`.
- `entrypoints/scheme.content.ts` (MAIN world) patches `matchMedia` and `@media (prefers-color-scheme)` rules while `<html data-force-dark-scheme="on">`; the background registers it early for Auto sites and injects it on demand.
- `src/theme/pipeline.ts` — mode → strategy selection; `strategies/` has `native-scheme`, `css-recolor`, `invert`.
- `src/theme/css-utils.ts` — pure CSS rewriting helpers (role-split custom properties, media context, base layer).
- Settings: `{ defaultMode, sites: { [hostname]: mode } }` in `storage.local` (legacy origin lists are migrated).

## Develop

```bash
bun install
bun run dev        # opens a browser with the extension
bun run test       # unit tests
bun run build      # .output/chrome-mv3  (build:firefox for Firefox)
bun run test:e2e   # builds, then drives Chromium through live mode switches
bun run test:site <url> [mode]   # screenshot a real site (.test-shots/site.png)
```

e2e scripts expect Chromium at `/Applications/Chromium.app` (override with `CHROME_PATH`). `HEADLESS=1` runs without a window (Chromium's new headless mode, which supports extensions).

## Browser tests

Everything below drives a real Chromium with the built extension loaded (`.output/chrome-mv3`).

| Command | What it runs |
| --- | --- |
| `bun run test:e2e` | Quick smoke (`scripts/e2e-modes.mjs`): mode switching, hydration, image darkening. |
| `bun run test:e2e:local` | The full offline matrix (`scripts/e2e/suites/*`), ~10 min. No network; fixtures are served locally (`*.localhost` gives us many origins). |
| `bun scripts/e2e/run.mjs <suite[,suite]> --grep=text` | One suite / one scenario. |

Local suites: `css-sources` (where colours can come from), `colors` (every colour syntax), `frameworks` (Tailwind, shadcn, Bootstrap, Primer, Material, kitchen-sink), `modes` (state machine, revert purity, races, per-host isolation, settings, script registration), `auto`, `matchmedia`, `frames`, `invert`, `images`, `lifecycle` (reload, bfcache, SPA, CSP, non-HTML documents), `perf`, `popup`.

### Known gaps

A scenario can assert `t.known(label, ok, reason)`: it is an *expected failure* for something the extension does not handle yet. The run stays green, prints the gap with its reason, and tells you when a gap starts passing (`XPASS`) so the marker can be removed. Plain `t.check` failures are real regressions. Only mark something known after confirming the cause — the reason string is documentation.

### Writing a scenario

```js
// scripts/e2e/suites/my-suite.mjs
import { mode } from '../harness.mjs';
import { doc, expectDark } from './_util.mjs';

export default function register({ scenario, server }) {
  server.add('/x/page.html', doc('<div id="a">hi</div>', { style: '#a{background:#fff}' }));
  scenario('white box gets dark', async (t) => {
    const page = await t.open('/x/page.html', { settings: mode('recolor') });
    await expectDark(t, page, '#a');
  });
}
```

`t.open` applies settings, loads the page, and waits for the extension's status. In-page helpers (`bgLuma`, `textScan` for contrast, `fingerprint`/`leftovers` for revert purity) live in `scripts/e2e/page-lib.mjs`; `t.shot` returns luminance stats and pixel samples of a screenshot. Every scenario also fails on extension console warnings or page errors unless it opts out with `allowIssues`.
