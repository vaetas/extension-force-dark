import { describe, expect, it } from 'vitest';
import { statusLabel } from './status-label';

describe('statusLabel', () => {
  it('says off whenever the site is disabled', () => {
    expect(statusLabel('recolor', false)).toBe('Off for this site');
    expect(statusLabel(null, false)).toBe('Off for this site');
  });

  it('does not keep an old off status after the site is enabled', () => {
    expect(statusLabel('off', true)).toBe('Updating…');
    expect(statusLabel('idle', true)).toBe('Updating…');
  });

  it('reports the strategy once the page has applied it', () => {
    expect(statusLabel('native', true)).toBe('Using this site’s dark theme');
    expect(statusLabel('recolor', true)).toBe('Recoloring this page');
    expect(statusLabel(null, true)).toBe('Force dark is enabled');
  });
});
