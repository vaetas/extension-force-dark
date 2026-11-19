/**
 * Helpers for rewriting prefers-color-scheme media text.
 * Shared with the MAIN-world content script.
 *
 * Dark scheme queries become always-matching, light scheme queries never
 * match. The result no longer contains prefers-color-scheme, so applying it
 * again is a no-op. A dark/light swap is not safe: a second pass undoes the
 * first and turns a site's dark theme off.
 */

export function forceDarkColorSchemeMedia(mediaText: string): string {
  if (!mediaMentionsColorScheme(mediaText) || isPrintMedia(mediaText)) {
    return mediaText;
  }
  return mediaText.replace(
    /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi,
    (_match, scheme: string) =>
      scheme.toLowerCase() === 'dark' ? '(min-width: 0px)' : '(max-width: 0px)',
  );
}

export function mediaMentionsColorScheme(mediaText: string): boolean {
  return /prefers-color-scheme/i.test(mediaText);
}

export function isPrintMedia(mediaText: string): boolean {
  return /\bprint\b/i.test(mediaText);
}
