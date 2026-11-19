import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  ensureContrast,
  formatRgba,
  modifyBackgroundColor,
  modifyForegroundColor,
  modifyShadowColor,
  parseColorString,
  srgbLightness,
} from './color';

describe('color transforms', () => {
  it('turns white and near-white neutrals into warm dark paper', () => {
    const white = modifyBackgroundColor({ r: 255, g: 255, b: 255, a: 1 });
    expect(srgbLightness(white)).toBeLessThan(0.2);
    expect(white.r).toBeGreaterThan(white.b);

    const nearWhite = modifyBackgroundColor({ r: 245, g: 245, b: 250, a: 1 });
    expect(srgbLightness(nearWhite)).toBeLessThan(0.25);
  });

  it('turns black text into warm light ink', () => {
    const ink = modifyForegroundColor({ r: 0, g: 0, b: 0, a: 1 });
    expect(srgbLightness(ink)).toBeGreaterThan(0.7);
    expect(ink.r).toBeGreaterThan(ink.b);
  });

  it('leaves already-dark backgrounds and already-light text alone', () => {
    const darkBg = { r: 20, g: 20, b: 24, a: 1 };
    expect(modifyBackgroundColor(darkBg)).toEqual(darkBg);

    const lightText = { r: 230, g: 230, b: 230, a: 1 };
    expect(modifyForegroundColor(lightText)).toEqual(lightText);
  });

  it('preserves alpha', () => {
    const result = modifyBackgroundColor({ r: 255, g: 255, b: 255, a: 0.4 });
    expect(result.a).toBe(0.4);
  });

  it('pulls light shadows toward black', () => {
    const shadow = modifyShadowColor({ r: 200, g: 200, b: 200, a: 0.5 });
    expect(srgbLightness(shadow)).toBeLessThan(0.25);
    expect(shadow.a).toBeGreaterThan(0);
  });

  it('raises paired black-on-white text to a readable contrast floor', () => {
    const bg = modifyBackgroundColor({ r: 255, g: 255, b: 255, a: 1 });
    const fg = modifyForegroundColor({ r: 0, g: 0, b: 0, a: 1 });
    const ensured = ensureContrast(fg, bg, 4.5);
    expect(contrastRatio(ensured, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('parses hex and rgb strings', () => {
    expect(parseColorString('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColorString('rgba(10, 20, 30, 0.5)')).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 0.5,
    });
    expect(formatRgba({ r: 1, g: 2, b: 3, a: 1 })).toBe('rgb(1, 2, 3)');
  });
});
