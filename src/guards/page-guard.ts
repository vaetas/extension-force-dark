export function isRestrictedUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === 'chrome:' ||
      parsed.protocol === 'chrome-extension:' ||
      parsed.protocol === 'about:' ||
      parsed.protocol === 'edge:' ||
      parsed.protocol === 'moz-extension:'
    ) {
      return true;
    }
    if (
      parsed.hostname === 'chrome.google.com' &&
      parsed.pathname.startsWith('/webstore')
    ) {
      return true;
    }
    if (parsed.hostname === 'chromewebstore.google.com') {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function isBlockedFrameHost(hostname: string, href?: string): boolean {
  const lower = hostname.toLowerCase();

  if (
    lower.includes('recaptcha') ||
    lower.includes('hcaptcha') ||
    lower.includes('challenges.cloudflare') ||
    lower.includes('doubleclick') ||
    lower.includes('googlesyndication') ||
    lower.includes('googleadservices') ||
    lower.includes('paypalobjects')
  ) {
    return true;
  }

  if (
    lower === 'js.stripe.com' ||
    lower.startsWith('hooks.stripe.') ||
    lower.includes('checkout.stripe.')
  ) {
    return true;
  }

  if (lower === 'www.google.com' && href) {
    try {
      if (new URL(href).pathname.includes('/recaptcha/')) return true;
    } catch {
      // ignore
    }
  }

  return false;
}

export function shouldSkipFrame(locationLike: {
  hostname: string;
  href: string;
  protocol: string;
}): boolean {
  if (isRestrictedUrl(locationLike.href)) return true;
  if (locationLike.protocol !== 'http:' && locationLike.protocol !== 'https:') {
    return true;
  }
  return isBlockedFrameHost(locationLike.hostname, locationLike.href);
}

/** about:blank and empty URLs show up mid-reload and are not the real tab. */
export function isTransientUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  return (
    url === 'about:srcdoc' ||
    url === 'about:blank' ||
    url.startsWith('about:blank')
  );
}

export function originFromUrl(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
