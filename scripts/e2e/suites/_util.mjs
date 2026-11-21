/* eslint-disable */
import { deflateSync } from 'node:zlib';
import { HOST } from '../harness.mjs';

export { HOST };

/** Wrap a body (and optional CSS / head) into a complete HTML document. */
export const doc = (body, { style = '', head = '', title = 'fixture', attrs = '' } = {}) =>
  `<!doctype html><html ${attrs}><head><meta charset="utf-8"><title>${title}</title>${head}${
    style ? `<style>${style}</style>` : ''
  }</head><body>${body}</body></html>`;

/** Solid-colour PNGs generated on the fly (no binary fixtures to maintain). */
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** `size`×`size` PNG; `pixel(x, y)` returns [r, g, b, a] (default: solid colour). */
export function makePng(rgb, size = 16, pixel = null) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a = 255] = pixel ? pixel(x, y) : [...rgb, 255];
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const SOLID = { white: [255, 255, 255], black: [17, 17, 17], red: [220, 20, 20], blue: [20, 60, 220] };
export const pngBuffer = (key, size = 16) => makePng(SOLID[key], size);
export const dataPng = (key, size = 16) => `data:image/png;base64,${pngBuffer(key, size).toString('base64')}`;

/** Luma thresholds used across suites. */
export const DARK = 0.3;
export const LIGHT_TEXT = 0.6;

/** Assert that an element's effective background is dark. */
export async function expectDark(t, page, sel, label = sel, max = DARK) {
  const l = await t.bgLuma(page, sel);
  return t.check(`${label} background is dark`, l < max, `luma ${l.toFixed(2)} (max ${max})`);
}
export async function expectLightText(t, page, sel, label = sel, min = LIGHT_TEXT) {
  const l = await t.fgLuma(page, sel);
  return t.check(`${label} text is light`, l > min, `luma ${l.toFixed(2)} (min ${min})`);
}
/** Known-gap flavour of expectDark. */
export async function knownDark(t, page, sel, label, reason, max = DARK) {
  const l = await t.bgLuma(page, sel);
  t.known(`${label} background is dark`, l < max, reason, `luma ${l.toFixed(2)}`);
}
