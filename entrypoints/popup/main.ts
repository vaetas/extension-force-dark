import { isRestrictedUrl, originFromUrl } from '../../src/guards/page-guard';
import {
  getTabThemeState,
  isOriginEnabled,
  loadSettings,
  saveSettings,
  setEnabledForAll,
  setOriginEnabled,
  type ForceDarkSettings,
  type PageThemeStatus,
} from '../../src/storage/settings';

const hostEl = document.getElementById('host') as HTMLParagraphElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const siteToggle = document.getElementById('site-toggle') as HTMLInputElement;
const globalToggle = document.getElementById(
  'global-toggle',
) as HTMLInputElement;

function statusLabel(status: PageThemeStatus | null, enabled: boolean): string {
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
      return 'Off for this site';
    default:
      return 'Force dark is enabled';
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function applySettings(next: ForceDarkSettings): Promise<void> {
  // Background listens for storage changes, re-registers scripts, and reloads
  // the active tab so document_start hooks run cleanly.
  await saveSettings(next);
}

async function render(): Promise<void> {
  const settings = await loadSettings();
  const tab = await getActiveTab();
  const restricted = !tab?.url || isRestrictedUrl(tab.url);
  const origin = tab?.url ? originFromUrl(tab.url) : null;

  globalToggle.checked = settings.enabledForAll;

  if (restricted || !origin || tab?.id == null) {
    hostEl.textContent = restricted
      ? 'This page can’t be changed'
      : 'No active site';
    siteToggle.checked = false;
    siteToggle.disabled = true;
    statusEl.textContent = 'This page can’t be changed';
    return;
  }

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
  statusEl.textContent = statusLabel(state?.status ?? null, enabled);
}

siteToggle.addEventListener('change', () => {
  void (async () => {
    const settings = await loadSettings();
    const tab = await getActiveTab();
    if (!tab?.url || tab.id == null) return;
    const origin = originFromUrl(tab.url);
    if (!origin) return;

    const next = setOriginEnabled(settings, origin, siteToggle.checked);
    await applySettings(next);
    // Brief delay so the reloaded tab can report status.
    setTimeout(() => {
      void render();
    }, 400);
  })();
});

globalToggle.addEventListener('change', () => {
  void (async () => {
    const settings = await loadSettings();
    const next = setEnabledForAll(settings, globalToggle.checked);
    await applySettings(next);
    setTimeout(() => {
      void render();
    }, 400);
  })();
});

void render();
