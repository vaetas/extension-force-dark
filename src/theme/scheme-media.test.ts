import { describe, expect, it } from 'vitest';
import {
  forceDarkColorSchemeMedia,
  isPrintMedia,
  mediaMentionsColorScheme,
} from './scheme-media';

describe('scheme media helpers', () => {
  it('forces dark scheme queries on and light scheme queries off', () => {
    expect(forceDarkColorSchemeMedia('(prefers-color-scheme: dark)')).toBe(
      '(min-width: 0px)',
    );
    expect(forceDarkColorSchemeMedia('(prefers-color-scheme: light)')).toBe(
      '(max-width: 0px)',
    );
    expect(
      forceDarkColorSchemeMedia(
        'screen and (prefers-color-scheme: dark) and (min-width: 800px)',
      ),
    ).toBe('screen and (min-width: 0px) and (min-width: 800px)');
  });

  it('does not toggle when applied twice and leaves print queries alone', () => {
    const once = forceDarkColorSchemeMedia('(prefers-color-scheme: dark)');
    expect(forceDarkColorSchemeMedia(once)).toBe(once);
    expect(
      forceDarkColorSchemeMedia('print and (prefers-color-scheme: dark)'),
    ).toBe('print and (prefers-color-scheme: dark)');
  });

  it('detects print and color-scheme media', () => {
    expect(isPrintMedia('print')).toBe(true);
    expect(mediaMentionsColorScheme('(prefers-color-scheme: dark)')).toBe(
      true,
    );
  });
});
