import { isRestrictedUrl, isTransientUrl, originFromUrl } from '../src/guards/page-guard';
import type { Message } from '../src/messaging/protocol';
import { shouldRetryInjection } from '../src/nav/injection-sync';
import {
  clearTabThemeState,
  DEFAULT_SETTINGS,
  isOriginEnabled,
  loadSettings,
  normalizeSettings,
  setTabThemeState,
  type ForceDarkSettings,
  type PageThemeStatus,
} from '../src/storage/settings';

const SCHEME_SCRIPT_ID = 'force-dark-scheme';
const THEME_SCRIPT_ID = 'force-dark-theme';
const MAX_CSS_BYTES = 2 * 1024 * 1024;
// Chrome can start the reload before new registerContentScripts match patterns
// are live. A short pause plus one probe-and-reload covers that race.
const SCRIPT_COMMIT_DELAY_MS = 50;

const cssLru = new Map<string, string>();

interface ExpectedInjection {
  origin: string;
  enabled: boolean;
  retries: number;
  generation: number;
  sawLoading: boolean;
}

let currentSettings: ForceDarkSettings = {
  enabledForAll: DEFAULT_SETTINGS.enabledForAll,
  disabledOrigins: [],
  enabledOrigins: [],
};
let settingsReady = false;
let appliedRegistrationKey = '';
let registrationQueue: Promise<void> = Promise.resolve();
let applyQueue: Promise<void> = Promise.resolve();
let injectionGeneration = 0;
const expectedInjection = new Map<number, ExpectedInjection>();
const latestReportTimeOrigin = new Map<number, number>();

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

function registrationKey(settings: ForceDarkSettings): string {
  return JSON.stringify(buildRegistration(settings));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function enqueueRegistration(settings: ForceDarkSettings, force = false): void {
  registrationQueue = registrationQueue
    .then(async () => {
      const key = registrationKey(settings);
      if (!force && appliedRegistrationKey === key) return;
      await unregisterScripts();
      const { matches, excludeMatches } = buildRegistration(settings);
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
      appliedRegistrationKey = key;
    })
    .catch((error) => {
      appliedRegistrationKey = '';
      console.warn('[ForceDark] content script registration failed', error);
    });
}

async function drainRegistrations(): Promise<void> {
  for (;;) {
    const pending = registrationQueue;
    await pending;
    if (registrationQueue === pending) return;
  }
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

async function syncTabBadge(
  tabId: number,
  url: string | undefined,
  settings: ForceDarkSettings,
): Promise<void> {
  if (isTransientUrl(url)) return;
  if (isRestrictedUrl(url)) {
    await updateActionIcon(tabId, false);
    return;
  }
  const origin = originFromUrl(url!);
  const enabled = origin ? isOriginEnabled(settings, origin) : false;
  await updateActionIcon(tabId, enabled);
}

async function syncAllBadges(settings: ForceDarkSettings): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return;
      await syncTabBadge(tab.id, tab.url, settings);
    }),
  );
}

async function readInjected(tabId: number): Promise<boolean | null> {
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      func: () =>
        document.documentElement?.getAttribute('data-force-dark') === '1' ||
        (globalThis as Record<string, unknown>)['__forceDarkInjected'] === true,
    });
    return injection?.result === true;
  } catch {
    return null;
  }
}

async function confirmInjection(tabId: number, url: string): Promise<void> {
  const expected = expectedInjection.get(tabId);
  if (!expected?.sawLoading) return;
  const origin = originFromUrl(url);
  if (!origin || origin !== expected.origin) {
    expectedInjection.delete(tabId);
    return;
  }

  const generation = expected.generation;
  const injected = await readInjected(tabId);
  const current = expectedInjection.get(tabId);
  if (!current || current.generation !== generation) return;

  if (
    !shouldRetryInjection({
      enabled: current.enabled,
      injected,
      retries: current.retries,
    })
  ) {
    expectedInjection.delete(tabId);
    return;
  }

  current.retries += 1;
  current.sawLoading = false;
  enqueueRegistration(currentSettings, true);
  await drainRegistrations();
  await delay(SCRIPT_COMMIT_DELAY_MS);
  const latest = expectedInjection.get(tabId);
  if (!latest || latest.generation !== generation) return;
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url || originFromUrl(tab.url) !== latest.origin) {
      expectedInjection.delete(tabId);
      return;
    }
    await browser.tabs.reload(tabId);
  } catch {
    expectedInjection.delete(tabId);
  }
}

function noteLoading(tabId: number): void {
  const expected = expectedInjection.get(tabId);
  if (expected) expected.sawLoading = true;
}

async function reloadActiveTab(settings: ForceDarkSettings): Promise<void> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || isTransientUrl(tab.url) || isRestrictedUrl(tab.url)) return;

  const origin = originFromUrl(tab.url!);
  if (!origin) return;

  const enabled = isOriginEnabled(settings, origin);
  const generation = ++injectionGeneration;
  expectedInjection.set(tab.id, {
    origin,
    enabled,
    retries: 0,
    generation,
    sawLoading: false,
  });
  await setTabThemeState(tab.id, {
    status: enabled ? 'idle' : 'off',
    origin,
    updatedAt: Date.now(),
  });

  try {
    await browser.tabs.reload(tab.id);
  } catch {
    expectedInjection.delete(tab.id);
  }
}

async function applyChangedSettings(settings: ForceDarkSettings): Promise<void> {
  enqueueRegistration(settings);
  await drainRegistrations();
  await delay(SCRIPT_COMMIT_DELAY_MS);
  await syncAllBadges(settings);
  await reloadActiveTab(settings);
}

export default defineBackground(() => {
  const boot = async () => {
    const loaded = await loadSettings();
    if (!settingsReady) currentSettings = loaded;
    settingsReady = true;
    enqueueRegistration(currentSettings);
    await drainRegistrations();
    await syncAllBadges(currentSettings);
  };

  const bootPromise = boot();

  browser.runtime.onInstalled.addListener(() => {
    void bootPromise.then(async () => {
      await delay(SCRIPT_COMMIT_DELAY_MS);
      await reloadActiveTab(currentSettings);
    });
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.forceDarkSettings?.newValue) return;
    currentSettings = normalizeSettings(
      changes.forceDarkSettings.newValue as Partial<ForceDarkSettings>,
    );
    settingsReady = true;
    const settings = currentSettings;
    applyQueue = applyQueue
      .then(() => applyChangedSettings(settings))
      .catch((error) => {
        console.warn('[ForceDark] settings apply failed', error);
      });
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') noteLoading(tabId);
    if (changeInfo.url && isTransientUrl(changeInfo.url)) return;

    const url = changeInfo.url ?? tab.url;
    void (async () => {
      await bootPromise;
      if (
        url &&
        !isTransientUrl(url) &&
        (changeInfo.status === 'loading' ||
          changeInfo.status === 'complete' ||
          changeInfo.url)
      ) {
        await syncTabBadge(tabId, url, currentSettings);
      }
      if (
        changeInfo.status === 'complete' &&
        tab.url &&
        !isTransientUrl(tab.url)
      ) {
        await confirmInjection(tabId, tab.url);
      }
    })();
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    void (async () => {
      await bootPromise;
      const tab = await browser.tabs.get(tabId);
      await syncTabBadge(tabId, tab.url, currentSettings);
    })();
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    expectedInjection.delete(tabId);
    latestReportTimeOrigin.delete(tabId);
    void clearTabThemeState(tabId);
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const typed = message as Message;
    const handle = async () => {
      switch (typed.type) {
        case 'GET_SETTINGS':
          return settingsReady ? currentSettings : loadSettings();
        case 'FETCH_STYLESHEET':
          return fetchStylesheet(typed.url);
        case 'REPORT_THEME_STATUS': {
          const tabId = sender.tab?.id;
          if (tabId == null) return { ok: true };
          const seen = latestReportTimeOrigin.get(tabId) ?? 0;
          if (typed.timeOrigin < seen) return { ok: true };
          latestReportTimeOrigin.set(tabId, typed.timeOrigin);
          const tabOrigin = sender.tab?.url
            ? originFromUrl(sender.tab.url)
            : null;
          if (tabOrigin && tabOrigin !== typed.origin) return { ok: true };
          await setTabThemeState(tabId, {
            status: typed.status as PageThemeStatus,
            origin: typed.origin,
            updatedAt: Date.now(),
          });
          const settings = settingsReady
            ? currentSettings
            : await loadSettings();
          const enabled = isOriginEnabled(settings, typed.origin);
          await updateActionIcon(tabId, enabled);
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
  });
});

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
