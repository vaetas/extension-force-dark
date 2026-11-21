import { hostFromUrl, isRestrictedUrl } from '../../src/guards/page-guard';
import {
  getTabThemeState,
  isSiteMode,
  loadSettings,
  modeFor,
  saveSettings,
  setDefaultMode,
  setSiteMode,
  SETTINGS_STORAGE_KEY,
  type SiteMode,
} from '../../src/storage/settings';
import { statusLabel } from '../../src/theme/status-label';

const hostEl = document.getElementById('host') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const modesEl = document.getElementById('modes') as HTMLElement;
const resetEl = document.getElementById('reset') as HTMLButtonElement;
const defaultSelect = document.getElementById('default-mode') as HTMLSelectElement;
const sitesDetails = document.getElementById('sites-details') as HTMLDetailsElement;
const sitesCount = document.getElementById('sites-count') as HTMLElement;
const sitesList = document.getElementById('sites-list') as HTMLUListElement;
const modeButtons = Array.from(
  modesEl.querySelectorAll<HTMLButtonElement>('button[data-mode]'),
);

let currentHost: string | null = null;
let writeChain: Promise<void> = Promise.resolve();

function mutateSettings(
  change: (s: Awaited<ReturnType<typeof loadSettings>>) => Awaited<ReturnType<typeof loadSettings>>,
): void {
  writeChain = writeChain
    .then(async () => saveSettings(change(await loadSettings())))
    .catch((error) => console.warn('[ForceDark] save failed', error));
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function render(): Promise<void> {
  const settings = await loadSettings();
  const tab = await getActiveTab();

  defaultSelect.value = settings.defaultMode;

  const url = tab?.url;
  const host = url && !isRestrictedUrl(url) ? hostFromUrl(url) : null;
  currentHost = host;

  for (const button of modeButtons) button.disabled = !host;
  resetEl.hidden = true;

  if (!host || tab?.id == null) {
    hostEl.textContent = 'No changeable page open';
    statusEl.textContent = 'Browser pages and stores can’t be themed.';
    for (const button of modeButtons) button.setAttribute('aria-checked', 'false');
  } else {
    hostEl.textContent = host;
    const mode = modeFor(settings, host);
    for (const button of modeButtons) {
      button.setAttribute('aria-checked', String(button.dataset.mode === mode));
    }
    resetEl.hidden = !(host in settings.sites);

    const state = await getTabThemeState(tab.id);
    const status = state && state.host === host ? state.status : null;
    statusEl.textContent = statusLabel(status, mode);
  }

  const entries = Object.entries(settings.sites).sort(([a], [b]) => a.localeCompare(b));
  sitesDetails.hidden = entries.length === 0;
  sitesCount.textContent = String(entries.length);
  sitesList.replaceChildren(
    ...entries.map(([siteHost, siteMode]) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = siteHost;
      const mode = document.createElement('span');
      mode.className = 'mode';
      mode.textContent = siteMode;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = 'Use default for this site';
      remove.textContent = '✕';
      remove.addEventListener('click', () =>
        mutateSettings((s) => setSiteMode(s, siteHost, null)),
      );
      li.append(name, mode, remove);
      return li;
    }),
  );
}

modesEl.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-mode]');
  const mode = button?.dataset.mode;
  if (!button || !currentHost || !isSiteMode(mode)) return;
  const host = currentHost;
  // Reflect immediately; storage change re-renders with the real status.
  for (const b of modeButtons) b.setAttribute('aria-checked', String(b === button));
  statusEl.textContent = mode === 'off' ? 'Off for this site' : 'Applying…';
  mutateSettings((s) => setSiteMode(s, host, mode as SiteMode));
});

resetEl.addEventListener('click', () => {
  if (!currentHost) return;
  const host = currentHost;
  mutateSettings((s) => setSiteMode(s, host, null));
});

defaultSelect.addEventListener('change', () => {
  const mode = defaultSelect.value;
  if (isSiteMode(mode)) mutateSettings((s) => setDefaultMode(s, mode));
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_STORAGE_KEY]) void render();
  else if (area === 'session' && Object.keys(changes).some((k) => k.startsWith('tabTheme:'))) {
    void render();
  }
});

void render();
