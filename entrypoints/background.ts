import { hostFromUrl, isRestrictedUrl } from '../src/guards/page-guard';
import type { Message, SampleImageResponse } from '../src/messaging/protocol';
import { SAMPLE_SIZE } from '../src/theme/image-classify';
import {
  clearTabThemeState,
  loadSettings,
  modeFor,
  normalizeSettings,
  saveSettings,
  setSiteMode,
  setTabThemeState,
  SETTINGS_STORAGE_KEY,
  type PageThemeStatus,
  type SiteMode,
} from '../src/storage/settings';

const SCHEME_SCRIPT_ID = 'force-dark-scheme';
/** Registered by earlier versions; must not linger after an update. */
const LEGACY_SCRIPT_IDS = ['force-dark-theme'];
const MAX_CSS_BYTES = 2 * 1024 * 1024;
const cssLru = new Map<string, string>();
const latestReport = new Map<number, number>();

// ---- MAIN-world scheme script registration -------------------------------
// Only "auto" hosts need the matchMedia patch early; registering it per host
// keeps it off every other page. Live switches inject it on demand instead.

function registrationFor(settings: {
  defaultMode: SiteMode;
  sites: Record<string, SiteMode>;
}): { matches: string[]; excludeMatches?: string[] } | null {
  const usable = (host: string): boolean => !/[[\]:]/.test(host);
  const pattern = (host: string): string => `*://${host}/*`;

  if (settings.defaultMode === 'auto') {
    const exclude = Object.entries(settings.sites)
      .filter(([host, mode]) => mode !== 'auto' && usable(host))
      .map(([host]) => pattern(host));
    return {
      matches: ['http://*/*', 'https://*/*'],
      ...(exclude.length > 0 ? { excludeMatches: exclude } : {}),
    };
  }
  const matches = Object.entries(settings.sites)
    .filter(([host, mode]) => mode === 'auto' && usable(host))
    .map(([host]) => pattern(host));
  return matches.length > 0 ? { matches } : null;
}

let registrationQueue: Promise<void> = Promise.resolve();
let appliedKey: string | null = null;

function syncRegistration(settings: Parameters<typeof registrationFor>[0]): void {
  registrationQueue = registrationQueue
    .then(async () => {
      const registration = registrationFor(settings);
      const key = JSON.stringify(registration);
      if (key === appliedKey) return;
      try {
        await browser.scripting.unregisterContentScripts({
          ids: [SCHEME_SCRIPT_ID, ...LEGACY_SCRIPT_IDS],
        });
      } catch {
        // Not registered yet.
      }
      if (registration) {
        await browser.scripting.registerContentScripts([
          {
            id: SCHEME_SCRIPT_ID,
            js: ['content-scripts/scheme.js'],
            world: 'MAIN',
            runAt: 'document_start',
            allFrames: true,
            persistAcrossSessions: true,
            ...registration,
          },
        ]);
      }
      appliedKey = key;
    })
    .catch((error) => {
      appliedKey = null;
      console.warn('[ForceDark] scheme registration failed', error);
    });
}

// ---- Badge / per-tab state -----------------------------------------------

async function updateBadge(tabId: number, status: PageThemeStatus): Promise<void> {
  const active = status === 'native' || status === 'recolor' || status === 'invert';
  try {
    await browser.action.setBadgeText({
      tabId,
      text: active ? 'ON' : status === 'pending' ? '…' : '',
    });
    await browser.action.setBadgeBackgroundColor({
      tabId,
      color: active ? '#3d8bfd' : '#666666',
    });
    await browser.action.setTitle({
      tabId,
      title: active ? `Force Dark: ${status}` : 'Force Dark: off',
    });
  } catch {
    // Tab may not allow action updates.
  }
}

// ---- Stylesheet fetch for cross-origin CSS -------------------------------

async function fetchStylesheet(
  url: string,
): Promise<{ ok: true; cssText: string } | { ok: false; error: string }> {
  const cached = cssLru.get(url);
  if (cached != null) return { ok: true, cssText: cached };
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_CSS_BYTES) return { ok: false, error: 'too large' };
    const cssText = new TextDecoder('utf-8').decode(buffer);
    cssLru.set(url, cssText);
    if (cssLru.size > 48) {
      const first = cssLru.keys().next().value;
      if (first) cssLru.delete(first);
    }
    return { ok: true, cssText };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'fetch failed',
    };
  }
}

// ---- Image sampling for cross-origin images -------------------------------
// The page can't read pixels of images it may not access; the background can
// fetch them (host permissions) and only hands back a tiny downscaled sample.

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const sampleCache = new Map<string, SampleImageResponse>();

async function sampleImage(url: string): Promise<SampleImageResponse> {
  if (!/^https?:/i.test(url)) return { ok: false, error: 'unsupported url' };
  const cached = sampleCache.get(url);
  if (cached) return cached;

  let result: SampleImageResponse;
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('too large');
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    bitmap.close();
    result = {
      ok: true,
      pixels: Array.from(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data),
    };
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : 'sample failed',
    };
  }
  sampleCache.set(url, result);
  if (sampleCache.size > 300) {
    const first = sampleCache.keys().next().value;
    if (first) sampleCache.delete(first);
  }
  return result;
}

// ---- Keyboard shortcut ----------------------------------------------------

async function toggleActiveSite(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || isRestrictedUrl(tab.url)) return;
  const host = hostFromUrl(tab.url);
  if (!host) return;

  const settings = await loadSettings();
  const current = modeFor(settings, host);
  const lastKey = `lastMode:${host}`;

  if (current !== 'off') {
    await browser.storage.session.set({ [lastKey]: current });
    await saveSettings(setSiteMode(settings, host, 'off'));
    return;
  }
  const stored = (await browser.storage.session.get(lastKey))[lastKey];
  const restore: SiteMode =
    stored === 'recolor' || stored === 'invert' || stored === 'auto'
      ? stored
      : 'auto';
  await saveSettings(setSiteMode(settings, host, restore));
}

// ---- Boot ------------------------------------------------------------------

export default defineBackground(() => {
  void loadSettings().then(syncRegistration);

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_STORAGE_KEY]) return;
    syncRegistration(normalizeSettings(changes[SETTINGS_STORAGE_KEY].newValue));
  });

  // Tabs that were already open never received the content script.
  browser.runtime.onInstalled.addListener(() => {
    void (async () => {
      const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
      for (const tab of tabs) {
        if (tab.id == null || isRestrictedUrl(tab.url)) continue;
        try {
          await browser.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['content-scripts/theme.js'],
          });
        } catch {
          // Tab not scriptable (store pages, etc).
        }
      }
    })();
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === 'toggle-site') void toggleActiveSite();
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    latestReport.delete(tabId);
    void clearTabThemeState(tabId);
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const typed = message as Message;
    const handle = async (): Promise<unknown> => {
      switch (typed.type) {
        case 'FETCH_STYLESHEET':
          return fetchStylesheet(typed.url);

        case 'SAMPLE_IMAGE':
          return sampleImage(typed.url);

        case 'ENSURE_SCHEME': {
          const tabId = sender.tab?.id;
          if (tabId == null) return { ok: false };
          try {
            await browser.scripting.executeScript({
              target: {
                tabId,
                ...(sender.frameId != null ? { frameIds: [sender.frameId] } : {}),
              },
              world: 'MAIN',
              files: ['content-scripts/scheme.js'],
            });
            return { ok: true };
          } catch {
            return { ok: false };
          }
        }

        case 'REPORT_THEME_STATUS': {
          const tabId = sender.tab?.id;
          if (tabId == null) return { ok: true };
          const seen = latestReport.get(tabId) ?? 0;
          if (typed.timeOrigin < seen) return { ok: true };
          latestReport.set(tabId, typed.timeOrigin);
          await setTabThemeState(tabId, {
            status: typed.status,
            host: typed.host,
            updatedAt: Date.now(),
          });
          await updateBadge(tabId, typed.status);
          return { ok: true };
        }

        default:
          return { ok: false };
      }
    };
    void handle().then(sendResponse);
    return true;
  });
});
