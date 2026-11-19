# Force Dark

A WXT + TypeScript browser extension that forces a dark theme on websites, with a per-site opt-out.

## How it works

1. **Native scheme** – patches `prefers-color-scheme` / `matchMedia` so sites that already ship a dark theme turn it on.
2. **CSS recolor** – if the page stays light, rewrites only color-related CSS into a warm night palette.
3. **Filter fallback** – if stylesheets are unreadable, applies a restrained invert filter (skipped on large canvas/video pages).

## Develop

```bash
bun install
bun run dev
```

## Test / build

```bash
bun run test
bun run build
```

Load the unpacked extension from `.output/chrome-mv3` (or use `bun run dev`, which opens a browser with the extension installed).
