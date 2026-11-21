import { hostFromUrl, isRestrictedUrl } from '../../src/guards/page-guard';
import {
  darkenImagesFor,
  getTabThemeState,
  isSiteMode,
  loadSettings,
  modeFor,
  saveSettings,
  setDarkenImagesDefault,
  setDefaultMode,
  setSiteDarkenImages,
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
const imagesSite = document.getElementById('images-site') as HTMLInputElement;
const imagesDefault = document.getElementById('images-default') as HTMLInputElement;
const modeButtons = Array.from(
  modesEl.querySelectorAll<HTMLButtonElement>('button[data-mode]'),
);

type Settings = Awaited<ReturnType<typeof loadSettings>>;
let currentHost: string | null = null;
let writeChain: Promise<void> = Promise.resolve();

function resetSite(s: Settings, host: string): Settings {
  return setSiteDarkenImages(setSiteMode(s, host, null), host, null);
}

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
  imagesDefault.checked = settings.darkenImages;

  const url = tab?.url;
  const host = url && !isRestrictedUrl(url) ? hostFromUrl(url) : null;
  currentHost = host;

  for (const button of modeButtons) button.disabled = !host;
  imagesSite.disabled = !host;
  imagesSite.checked = host ? darkenImagesFor(settings, host) : false;
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
    resetEl.hidden = !(host in settings.sites || host in settings.imageSites);

    const state = await getTabThemeState(tab.id);
    const status = state && state.host === host ? state.status : null;
    statusEl.textContent = statusLabel(status, mode);
  }

  const hosts = [...new Set([...Object.keys(settings.sites), ...Object.keys(settings.imageSites)])].sort();
  const entries = hosts.map((h) => {
    const parts: string[] = [];
    if (h in settings.sites) parts.push(settings.sites[h]);
    if (h in settings.imageSites) parts.push(settings.imageSites[h] ? 'images on' : 'images off');
    return [h, parts.join(' · ')] as const;
  });
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
        mutateSettings((s) => resetSite(s, siteHost)),
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
  mutateSettings((s) => resetSite(s, host));
});

imagesSite.addEventListener('change', () => {
  if (!currentHost) return;
  const host = currentHost;
  const on = imagesSite.checked;
  mutateSettings((s) => setSiteDarkenImages(s, host, on));
});

imagesDefault.addEventListener('change', () => {
  const on = imagesDefault.checked;
  mutateSettings((s) => setDarkenImagesDefault(s, on));
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
