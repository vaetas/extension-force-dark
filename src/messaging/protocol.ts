import type { PageThemeStatus } from '../storage/settings';

export type Message =
  | { type: 'GET_SETTINGS' }
  | { type: 'FETCH_STYLESHEET'; url: string }
  | {
      type: 'REPORT_THEME_STATUS';
      status: PageThemeStatus;
      origin: string;
    }
  | { type: 'RELOAD_TAB' };

export type FetchStylesheetResponse =
  | { ok: true; cssText: string }
  | { ok: false; error: string };
