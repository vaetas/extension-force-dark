import { describe, expect, it } from 'vitest';
import {
  isBlockedFrameHost,
  isRestrictedUrl,
  originFromUrl,
  shouldSkipFrame,
} from './page-guard';

describe('page guard', () => {
  it('restricts browser-internal pages and the web store', () => {
    expect(isRestrictedUrl('chrome://flags')).toBe(true);
    expect(isRestrictedUrl('https://chromewebstore.google.com/detail/x')).toBe(
      true,
    );
    expect(isRestrictedUrl('https://example.com')).toBe(false);
  });

  it('blocks captcha and ad embed hosts without blocking google search', () => {
    expect(isBlockedFrameHost('www.google.com', 'https://www.google.com/search')).toBe(
      false,
    );
    expect(
      isBlockedFrameHost(
        'www.google.com',
        'https://www.google.com/recaptcha/api2/anchor',
      ),
    ).toBe(true);
    expect(isBlockedFrameHost('challenges.cloudflare.com')).toBe(true);
    expect(isBlockedFrameHost('js.stripe.com')).toBe(true);
  });

  it('skips non-http frames', () => {
    expect(
      shouldSkipFrame({
        hostname: 'example.com',
        href: 'https://example.com',
        protocol: 'https:',
      }),
    ).toBe(false);
    expect(
      shouldSkipFrame({
        hostname: '',
        href: 'about:blank',
        protocol: 'about:',
      }),
    ).toBe(true);
  });

  it('parses origins', () => {
    expect(originFromUrl('https://example.com/path')).toBe(
      'https://example.com',
    );
  });
});
