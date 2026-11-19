import { isRestrictedUrl, originFromUrl } from '../src/guards/page-guard';
import type { Message } from '../src/messaging/protocol';
import {
  clearTabThemeState,
  isOriginEnabled,
  loadSettings,
  saveSettings,
  setTabThemeState,
  type ForceDarkSettings,
  type PageThemeStatus,
} from '../src/storage/settings';

const SCHEME_SCRIPT_ID = 'force-dark-scheme';
const THEME_SCRIPT_ID = 'force-dark-theme';
const MAX_CSS_BYTES = 2 * 1024 * 1024;

const cssLru = new Map<string, string>();

function originToMatchPattern(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}

function buildRegistration(settings: ForceDarkSettings): {
  matches: string[];
  excludeMatches: string[];
} {
  if (settings.enabledForAll) {
    return {
      matches: ['http://*/*', 'https://*/*'],
      excludeMatches: settings.disabledOrigins
        .map(originToMatchPattern)
        .filter((v): v is string => Boolean(v)),
    };
  }

  const matches = settings.enabledOrigins
    .map(originToMatchPattern)
    .filter((v): v is string => Boolean(v));

  return {
    matches: matches.length > 0 ? matches : ['https://force-dark.invalid/*'],
    excludeMatches: [],
  };
}

async function unregisterScripts(): Promise<void> {
  try {
    await browser.scripting.unregisterContentScripts({
      ids: [SCHEME_SCRIPT_ID, THEME_SCRIPT_ID],
    });
  } catch {
    // Scripts may not be registered yet.
  }
}

async function registerScripts(settings: ForceDarkSettings): Promise<void> {
  const { matches, excludeMatches } = buildRegistration(settings);
  await unregisterScripts();

  const shared = {
    matches,
    runAt: 'document_start' as const,
    allFrames: true,
    persistAcrossSessions: true,
    ...(excludeMatches.length > 0 ? { excludeMatches } : {}),
  };

  await browser.scripting.registerContentScripts([
    {
      id: SCHEME_SCRIPT_ID,
      js: ['content-scripts/scheme.js'],
      world: 'MAIN',
      ...shared,
    },
    {
      id: THEME_SCRIPT_ID,
      js: ['content-scripts/theme.js'],
      ...shared,
    },
  ]);
}

async function updateActionIcon(
  tabId: number,
  enabled: boolean,
): Promise<void> {
  try {
    await browser.action.setBadgeText({
      tabId,
      text: enabled ? 'ON' : '',
    });
    await browser.action.setBadgeBackgroundColor({
      tabId,
      color: enabled ? '#3d8bfd' : '#666666',
    });
    await browser.action.setTitle({
      tabId,
      title: enabled ? 'Force Dark: on' : 'Force Dark: off',
    });
  } catch {
    // Tab may not allow action updates.
  }
}

async function syncTabBadge(tabId: number, url?: string): Promise<void> {
  const settings = await loadSettings();
  if (!url || isRestrictedUrl(url)) {
    await updateActionIcon(tabId, settings.enabledForAll);
    return;
  }
  const origin = originFromUrl(url);
  const enabled = origin ? isOriginEnabled(settings, origin) : false;
  await updateActionIcon(tabId, enabled);
}

async function refreshActiveTab(settings: ForceDarkSettings): Promise<void> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url || isRestrictedUrl(tab.url)) return;

  const origin = originFromUrl(tab.url);
  if (!origin) return;

  const enabled = isOriginEnabled(settings, origin);
  await updateActionIcon(tab.id, enabled);

  try {
    await browser.tabs.reload(tab.id);
  } catch {
    // Ignore reload failures on restricted pages.
  }
}

async function fetchStylesheet(
  url: string,
): Promise<{ ok: true; cssText: string } | { ok: false; error: string }> {
  const cached = cssLru.get(url);
  if (cached != null) {
    return { ok: true, cssText: cached };
  }

  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_CSS_BYTES) {
      return { ok: false, error: 'too large' };
    }
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

export default defineBackground(() => {
  const boot = async () => {
    const settings = await loadSettings();
    await saveSettings(settings);
    await registerScripts(settings);
  };

  browser.runtime.onInstalled.addListener(() => {
    void boot();
  });

  browser.runtime.onStartup.addListener(() => {
    void boot();
  });

  void boot();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.forceDarkSettings) return;
    void (async () => {
      const settings = await loadSettings();
      await registerScripts(settings);
      await refreshActiveTab(settings);
    })();
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' || changeInfo.url) {
      void syncTabBadge(tabId, changeInfo.url ?? tab.url);
    }
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    void (async () => {
      const tab = await browser.tabs.get(tabId);
      await syncTabBadge(tabId, tab.url);
    })();
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void clearTabThemeState(tabId);
  });

  browser.runtime.onMessage.addListener(
    (message: Message, sender, sendResponse) => {
      const handle = async () => {
        switch (message.type) {
          case 'GET_SETTINGS':
            return loadSettings();
          case 'FETCH_STYLESHEET':
            return fetchStylesheet(message.url);
          case 'REPORT_THEME_STATUS': {
            const tabId = sender.tab?.id;
            if (tabId != null) {
              await setTabThemeState(tabId, {
                status: message.status as PageThemeStatus,
                origin: message.origin,
                updatedAt: Date.now(),
              });
              const settings = await loadSettings();
              const enabled = isOriginEnabled(settings, message.origin);
              await updateActionIcon(tabId, enabled);
            }
            return { ok: true };
          }
          case 'RELOAD_TAB': {
            const tabId = sender.tab?.id;
            if (tabId != null) {
              await browser.tabs.reload(tabId);
            }
            return { ok: true };
          }
          default:
            return { ok: false };
        }
      };

      void handle().then(sendResponse);
      return true;
    },
  );
});
