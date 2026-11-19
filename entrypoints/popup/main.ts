import { isRestrictedUrl, isTransientUrl, originFromUrl } from '../../src/guards/page-guard';
import {
  getTabThemeState,
  isOriginEnabled,
  loadSettings,
  saveSettings,
  setEnabledForAll,
  setOriginEnabled,
  type ForceDarkSettings,
} from '../../src/storage/settings';
import { statusLabel } from '../../src/theme/status-label';

const hostEl = document.getElementById('host') as HTMLParagraphElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const siteToggle = document.getElementById('site-toggle') as HTMLInputElement;
const globalToggle = document.getElementById(
  'global-toggle',
) as HTMLInputElement;

let renderGeneration = 0;
let writeChain: Promise<void> = Promise.resolve();
let shownOrigin: string | null = null;

function enqueueSettingsWrite(task: () => Promise<void>): void {
  writeChain = writeChain.then(task).catch((error) => {
    console.warn('[ForceDark] settings write failed', error);
  });
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function applySettings(next: ForceDarkSettings): Promise<void> {
  // Background re-registers scripts, then reloads the active tab.
  await saveSettings(next);
}

async function render(): Promise<void> {
  const generation = ++renderGeneration;
  const settings = await loadSettings();
  const tab = await getActiveTab();
  if (generation !== renderGeneration) return;

  globalToggle.checked = settings.enabledForAll;

  const url = tab?.url;
  if (tab?.id == null || !url || isTransientUrl(url)) {
    siteToggle.disabled = true;
    statusEl.textContent = 'Updating…';
    return;
  }

  if (isRestrictedUrl(url)) {
    shownOrigin = null;
    hostEl.textContent = 'This page can’t be changed';
    siteToggle.checked = false;
    siteToggle.disabled = true;
    statusEl.textContent = 'This page can’t be changed';
    return;
  }

  const origin = originFromUrl(url);
  if (!origin) {
    shownOrigin = null;
    hostEl.textContent = 'No active site';
    siteToggle.checked = false;
    siteToggle.disabled = true;
    statusEl.textContent = 'This page can’t be changed';
    return;
  }
  shownOrigin = origin;

  let host = origin;
  try {
    host = new URL(origin).host;
  } catch {
    // keep origin
  }
  hostEl.textContent = host;

  const enabled = isOriginEnabled(settings, origin);
  siteToggle.disabled = false;
  siteToggle.checked = enabled;

  const state = await getTabThemeState(tab.id);
  if (generation !== renderGeneration) return;
  statusEl.textContent = statusLabel(state?.status ?? null, enabled);
}

siteToggle.addEventListener('change', () => {
  const enabled = siteToggle.checked;
  const originHint = shownOrigin;
  renderGeneration += 1;
  enqueueSettingsWrite(async () => {
    const settings = await loadSettings();
    let origin = originHint;
    if (!origin) {
      const tab = await getActiveTab();
      if (
        !tab?.url ||
        tab.id == null ||
        isTransientUrl(tab.url) ||
        isRestrictedUrl(tab.url)
      ) {
        return;
      }
      origin = originFromUrl(tab.url);
    }
    if (!origin) return;
    await applySettings(setOriginEnabled(settings, origin, enabled));
    await render();
  });
});

globalToggle.addEventListener('change', () => {
  const enabledForAll = globalToggle.checked;
  renderGeneration += 1;
  enqueueSettingsWrite(async () => {
    const settings = await loadSettings();
    await applySettings(setEnabledForAll(settings, enabledForAll));
    await render();
  });
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.forceDarkSettings) {
    void render();
    return;
  }
  if (
    area === 'session' &&
    Object.keys(changes).some((key) => key.startsWith('tabTheme:'))
  ) {
    void render();
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete' && !changeInfo.url) return;
  void (async () => {
    const active = await getActiveTab();
    if (active?.id !== tabId) return;
    await render();
  })();
});

void render();
