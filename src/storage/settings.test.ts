import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  isOriginEnabled,
  setEnabledForAll,
  setOriginEnabled,
} from './settings';

describe('isOriginEnabled', () => {
  it('enables all origins when master switch is on', () => {
    expect(
      isOriginEnabled(DEFAULT_SETTINGS, 'https://example.com'),
    ).toBe(true);
  });

  it('respects disabledOrigins when master switch is on', () => {
    const settings = setOriginEnabled(
      DEFAULT_SETTINGS,
      'https://example.com',
      false,
    );
    expect(isOriginEnabled(settings, 'https://example.com')).toBe(false);
    expect(isOriginEnabled(settings, 'https://other.com')).toBe(true);
  });

  it('requires enabledOrigins when master switch is off', () => {
    const off = setEnabledForAll(DEFAULT_SETTINGS, false);
    expect(isOriginEnabled(off, 'https://example.com')).toBe(false);

    const onSite = setOriginEnabled(off, 'https://example.com', true);
    expect(isOriginEnabled(onSite, 'https://example.com')).toBe(true);
    expect(isOriginEnabled(onSite, 'https://other.com')).toBe(false);
  });

  it('re-enables a previously disabled origin', () => {
    const disabled = setOriginEnabled(
      DEFAULT_SETTINGS,
      'https://example.com',
      false,
    );
    const enabled = setOriginEnabled(disabled, 'https://example.com', true);
    expect(enabled.disabledOrigins).toEqual([]);
    expect(isOriginEnabled(enabled, 'https://example.com')).toBe(true);
  });
});
