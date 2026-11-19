import { describe, expect, it } from 'vitest';
import { shouldRetryInjection } from './injection-sync';

describe('shouldRetryInjection', () => {
  it('reloads once when the page does not match the setting', () => {
    expect(
      shouldRetryInjection({ enabled: true, injected: false, retries: 0 }),
    ).toBe(true);
    expect(
      shouldRetryInjection({ enabled: false, injected: true, retries: 0 }),
    ).toBe(true);
  });

  it('stops after one retry and when the probe fails', () => {
    expect(
      shouldRetryInjection({ enabled: true, injected: false, retries: 1 }),
    ).toBe(false);
    expect(
      shouldRetryInjection({ enabled: true, injected: null, retries: 0 }),
    ).toBe(false);
    expect(
      shouldRetryInjection({ enabled: true, injected: true, retries: 0 }),
    ).toBe(false);
  });
});
