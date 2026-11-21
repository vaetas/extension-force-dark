import { describe, expect, it } from 'vitest';
import { statusLabel } from './status-label';

describe('statusLabel', () => {
  it('says off whenever the site mode is off', () => {
    expect(statusLabel('recolor', 'off')).toBe('Off for this site');
    expect(statusLabel(null, 'off')).toBe('Off for this site');
  });

  it('reports the strategy once applied', () => {
    expect(statusLabel('native', 'auto')).toBe('Using this site’s own dark theme');
    expect(statusLabel('recolor', 'recolor')).toBe('Recoloring this page');
    expect(statusLabel('invert', 'invert')).toBe('Inverting this page');
  });

  it('does not keep a stale off status after enabling', () => {
    expect(statusLabel('off', 'auto')).toBe('Applying…');
    expect(statusLabel(null, 'auto')).toBe('Waiting for the page…');
  });
});
