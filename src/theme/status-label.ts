import type { PageThemeStatus, SiteMode } from '../storage/settings';

export function statusLabel(
  status: PageThemeStatus | null,
  mode: SiteMode,
): string {
  if (mode === 'off') return 'Off for this site';
  switch (status) {
    case 'native':
      return 'Using this site’s own dark theme';
    case 'recolor':
      return 'Recoloring this page';
    case 'invert':
      return 'Inverting this page';
    case 'blocked':
      return 'This page can’t be changed';
    case 'pending':
    case 'off':
      return 'Applying…';
    default:
      return 'Waiting for the page…';
  }
}
