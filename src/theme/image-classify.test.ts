import { describe, expect, it } from 'vitest';
import { classifyImagePixels, SAMPLE_SIZE } from './image-classify';

const S = SAMPLE_SIZE;

function image(
  pixel: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      data.set(pixel(x, y), (y * S + x) * 4);
    }
  }
  return data;
}

describe('classifyImagePixels', () => {
  it('inverts black text on a white background', () => {
    const logo = image((x, y) =>
      y > 9 && y < 14 && x > 3 && x < 20 ? [20, 20, 20, 255] : [255, 255, 255, 255],
    );
    expect(classifyImagePixels(logo)).toBe('bg');
  });

  it('inverts a few-colour chart on white', () => {
    const chart = image((x, y) => {
      if (x > 4 && x < 10 && y > 10 && y < 21) return [220, 40, 40, 255];
      if (x > 13 && x < 19 && y > 5 && y < 21) return [40, 90, 200, 255];
      return [250, 250, 250, 255];
    });
    expect(classifyImagePixels(chart)).toBe('bg');
  });

  it('leaves photos alone, even with a white border', () => {
    const photo = image((x, y) => {
      const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
      if (edge) return [255, 255, 255, 255];
      return [(x * 11 + y * 5) % 256, (x * 7 + y * 13) % 256, (x * 3 + y * 17) % 256, 255];
    });
    expect(classifyImagePixels(photo)).toBe('skip');
  });

  it('leaves dark opaque images alone', () => {
    expect(classifyImagePixels(image(() => [15, 15, 20, 255]))).toBe('skip');
  });

  it('inverts transparent cut-outs with dark content', () => {
    const icon = image((x, y) =>
      x > 6 && x < 17 && y > 6 && y < 17 ? [10, 10, 10, 255] : [0, 0, 0, 0],
    );
    expect(classifyImagePixels(icon)).toBe('ink');
  });

  it('leaves transparent cut-outs with light content alone', () => {
    const icon = image((x, y) =>
      x > 6 && x < 17 && y > 6 && y < 17 ? [240, 240, 240, 255] : [0, 0, 0, 0],
    );
    expect(classifyImagePixels(icon)).toBe('skip');
  });

  it('ignores malformed input', () => {
    expect(classifyImagePixels(new Uint8ClampedArray(4))).toBe('skip');
  });
});
