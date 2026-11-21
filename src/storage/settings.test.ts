import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  darkenImagesFor,
  setDarkenImagesDefault,
  setSiteDarkenImages,
  modeFor,
  normalizeSettings,
  setDefaultMode,
  setSiteMode,
} from './settings';

describe('modeFor', () => {
  it('uses the default when a site has no override', () => {
    expect(modeFor(DEFAULT_SETTINGS, 'example.com')).toBe('off');
    expect(modeFor(setDefaultMode(DEFAULT_SETTINGS, 'auto'), 'a.com')).toBe(
      'auto',
    );
  });

  it('prefers the site override, including an explicit off', () => {
    const auto = setDefaultMode(DEFAULT_SETTINGS, 'auto');
    const s = setSiteMode(auto, 'a.com', 'off');
    expect(modeFor(s, 'a.com')).toBe('off');
    expect(modeFor(s, 'b.com')).toBe('auto');
  });

  it('removes an override with null', () => {
    const s = setSiteMode(setSiteMode(DEFAULT_SETTINGS, 'a.com', 'invert'), 'a.com', null);
    expect(s.sites).toEqual({});
  });
});

describe('normalizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ sites: { 'a.com': 'bogus' } }).sites).toEqual({});
  });

  it('migrates the legacy origin lists', () => {
    const s = normalizeSettings({
      enabledForAll: true,
      enabledOrigins: ['https://a.com'],
      disabledOrigins: ['https://b.com:8080'],
    });
    expect(s.defaultMode).toBe('auto');
    expect(s.sites).toEqual({ 'a.com': 'auto', 'b.com': 'off' });
  });
});

describe('darkenImagesFor', () => {
  it('is off unless explicitly opted in', () => {
    expect(darkenImagesFor(DEFAULT_SETTINGS, 'a.com')).toBe(false);
  });

  it('follows the default and lets a site override it either way', () => {
    const on = setDarkenImagesDefault(DEFAULT_SETTINGS, true);
    expect(darkenImagesFor(on, 'a.com')).toBe(true);
    const mixed = setSiteDarkenImages(on, 'broken.com', false);
    expect(darkenImagesFor(mixed, 'broken.com')).toBe(false);
    expect(darkenImagesFor(mixed, 'a.com')).toBe(true);
    const reset = setSiteDarkenImages(mixed, 'broken.com', null);
    expect(darkenImagesFor(reset, 'broken.com')).toBe(true);
  });

  it('ignores malformed stored values', () => {
    const s = normalizeSettings({ darkenImages: 'yes', imageSites: { 'a.com': 1, 'b.com': true } });
    expect(s.darkenImages).toBe(false);
    expect(s.imageSites).toEqual({ 'b.com': true });
  });
});
