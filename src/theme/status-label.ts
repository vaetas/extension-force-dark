import type { PageThemeStatus } from '../storage/settings';

export function statusLabel(
  status: PageThemeStatus | null,
  enabled: boolean,
): string {
  if (!enabled) return 'Off for this site';
  switch (status) {
    case 'native':
      return 'Using this site’s dark theme';
    case 'recolor':
      return 'Recoloring this page';
    case 'filter':
      return 'Approximated with a filter';
    case 'blocked':
      return 'This page can’t be changed';
    case 'off':
    case 'idle':
      return 'Updating…';
    default:
      return 'Force dark is enabled';
  }
}
