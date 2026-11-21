/**
 * Decide from a tiny downscaled copy of an image whether it should be
 * inverted on a dark page. Pure, so it is unit tested without a browser.
 *
 * - `bg`   opaque image on a light background (logo, diagram, chart).
 *          Inverted and blended so the light area takes the page colour.
 * - `ink`  mostly transparent image with dark content (cut-out logo, icon)
 *          that would vanish on a dark page. Plain inversion.
 * - `skip` everything else, notably photos.
 */
export type ImageVerdict = 'bg' | 'ink' | 'skip';

/** Edge length of the square sample both the page and background produce. */
export const SAMPLE_SIZE = 24;

const TRANSPARENT_ALPHA = 0.15;
const LIGHT_LUMA = 0.85;
/** Few distinct colours = flat artwork; photos blow past this. */
const MAX_COLOR_BUCKETS = 24;

function luma(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function classifyImagePixels(
  data: ArrayLike<number>,
  size: number = SAMPLE_SIZE,
): ImageVerdict {
  const total = size * size;
  if (data.length < total * 4) return 'skip';

  let transparent = 0;
  let opaque = 0;
  let opaqueLumaSum = 0;
  let lightOpaque = 0;
  let borderTotal = 0;
  let borderLight = 0;
  const buckets = new Set<number>();

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const a = data[i + 3] / 255;
      const onBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      if (onBorder) borderTotal += 1;

      if (a < TRANSPARENT_ALPHA) {
        transparent += 1;
        continue;
      }
      const l = luma(data[i], data[i + 1], data[i + 2]);
      opaque += 1;
      opaqueLumaSum += l;
      if (a > 0.9 && l >= LIGHT_LUMA) {
        lightOpaque += 1;
        if (onBorder) borderLight += 1;
      }
      buckets.add(
        ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5),
      );
    }
  }

  // Cut-out artwork: only worth inverting if its content is dark.
  if (transparent / total >= 0.35) {
    if (opaque < total * 0.02) return 'skip';
    if (buckets.size > MAX_COLOR_BUCKETS) return 'skip';
    return opaqueLumaSum / opaque <= 0.45 ? 'ink' : 'skip';
  }

  if (
    borderLight / borderTotal >= 0.9 &&
    lightOpaque / total >= 0.5 &&
    buckets.size <= MAX_COLOR_BUCKETS
  ) {
    return 'bg';
  }
  return 'skip';
}
