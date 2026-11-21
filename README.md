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

e2e scripts expect Chromium at `/Applications/Chromium.app` (override with `CHROME_PATH` for `test:e2e`).
