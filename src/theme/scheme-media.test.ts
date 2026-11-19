import { describe, expect, it } from 'vitest';
import {
  isPrintMedia,
  mediaMentionsColorScheme,
  swapColorSchemeMedia,
} from './scheme-media';

describe('scheme media helpers', () => {
  it('swaps dark and light in prefers-color-scheme queries', () => {
    expect(swapColorSchemeMedia('(prefers-color-scheme: dark)')).toBe(
      '(prefers-color-scheme: light)',
    );
    expect(swapColorSchemeMedia('(prefers-color-scheme: light)')).toBe(
      '(prefers-color-scheme: dark)',
    );
  });

  it('detects print and color-scheme media', () => {
    expect(isPrintMedia('print')).toBe(true);
    expect(mediaMentionsColorScheme('(prefers-color-scheme: dark)')).toBe(
      true,
    );
  });
});
