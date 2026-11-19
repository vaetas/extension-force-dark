/**
 * Helpers for rewriting prefers-color-scheme media text.
 * Shared conceptually with the MAIN-world content script.
 */

export function swapColorSchemeMedia(mediaText: string): string {
  return mediaText.replace(
    /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi,
    (_match, scheme: string) => {
      const swapped = scheme.toLowerCase() === 'dark' ? 'light' : 'dark';
      return `(prefers-color-scheme: ${swapped})`;
    },
  );
}

export function mediaMentionsColorScheme(mediaText: string): boolean {
  return /prefers-color-scheme/i.test(mediaText);
}

export function isPrintMedia(mediaText: string): boolean {
  return /\bprint\b/i.test(mediaText);
}
