import type { PageThemeStatus } from '../storage/settings';

export type Message =
  | { type: 'FETCH_STYLESHEET'; url: string }
  | { type: 'ENSURE_SCHEME' }
  | { type: 'SAMPLE_IMAGE'; url: string }
  | {
      type: 'REPORT_THEME_STATUS';
      status: PageThemeStatus;
      host: string;
      /** performance.timeOrigin for this document, so stale reports lose. */
      timeOrigin: number;
    };

export type FetchStylesheetResponse =
  | { ok: true; cssText: string }
  | { ok: false; error: string };

/** RGBA pixels of the image downscaled to SAMPLE_SIZE², row-major. */
export type SampleImageResponse =
  | { ok: true; pixels: number[] }
  | { ok: false; error: string };
