export type SiteMode = 'off' | 'auto' | 'recolor' | 'invert';

export const SITE_MODES: readonly SiteMode[] = [
  'off',
  'auto',
  'recolor',
  'invert',
];

export interface ForceDarkSettings {
  /** Mode for any site without an explicit entry in `sites`. */
  defaultMode: SiteMode;
  /** Per-hostname overrides. */
  sites: Record<string, SiteMode>;
  /** Experimental: invert light-background images. Opt-in, off by default. */
  darkenImages: boolean;
  /** Per-hostname override of `darkenImages`. */
  imageSites: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: ForceDarkSettings = {
  defaultMode: 'off',
  sites: {},
  darkenImages: false,
  imageSites: {},
};

export type PageThemeStatus =
  | 'native'
  | 'recolor'
  | 'invert'
  | 'off'
  | 'blocked'
  | 'pending';

export interface TabThemeState {
  status: PageThemeStatus;
  host: string;
  updatedAt: number;
}

const SETTINGS_KEY = 'forceDarkSettings';

export function isSiteMode(value: unknown): value is SiteMode {
  return typeof value === 'string' && SITE_MODES.includes(value as SiteMode);
}

export function modeFor(settings: ForceDarkSettings, host: string): SiteMode {
  if (!host) return 'off';
  return settings.sites[host] ?? settings.defaultMode;
}

/** `mode === null` removes the override so the site follows the default. */
export function setSiteMode(
  settings: ForceDarkSettings,
  host: string,
  mode: SiteMode | null,
): ForceDarkSettings {
  const sites = { ...settings.sites };
  if (mode === null) delete sites[host];
  else sites[host] = mode;
  return { ...settings, sites };
}

export function darkenImagesFor(
  settings: ForceDarkSettings,
  host: string,
): boolean {
  if (!host) return false;
  return settings.imageSites[host] ?? settings.darkenImages;
}

/** `value === null` removes the override so the site follows the default. */
export function setSiteDarkenImages(
  settings: ForceDarkSettings,
  host: string,
  value: boolean | null,
): ForceDarkSettings {
  const imageSites = { ...settings.imageSites };
  if (value === null) delete imageSites[host];
  else imageSites[host] = value;
  return { ...settings, imageSites };
}

export function setDarkenImagesDefault(
  settings: ForceDarkSettings,
  darkenImages: boolean,
): ForceDarkSettings {
  return { ...settings, darkenImages };
}

export function setDefaultMode(
  settings: ForceDarkSettings,
  defaultMode: SiteMode,
): ForceDarkSettings {
  return { ...settings, defaultMode };
}

function hostFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname || null;
  } catch {
    return null;
  }
}

/** Accepts the current shape and migrates the legacy origin-list shape. */
export function normalizeSettings(stored: unknown): ForceDarkSettings {
  if (!stored || typeof stored !== 'object') {
    return { ...DEFAULT_SETTINGS, sites: {}, imageSites: {} };
  }
  const raw = stored as Record<string, unknown>;
  const sites: Record<string, SiteMode> = {};

  if (raw.sites && typeof raw.sites === 'object') {
    for (const [host, mode] of Object.entries(raw.sites)) {
      if (isSiteMode(mode)) sites[host] = mode;
    }
  }

  const imageSites: Record<string, boolean> = {};
  if (raw.imageSites && typeof raw.imageSites === 'object') {
    for (const [host, value] of Object.entries(raw.imageSites)) {
      if (typeof value === 'boolean') imageSites[host] = value;
    }
  }

  // Legacy: enabledOrigins / disabledOrigins / enabledForAll.
  if (Array.isArray(raw.enabledOrigins)) {
    for (const origin of raw.enabledOrigins) {
      const host = typeof origin === 'string' ? hostFromOrigin(origin) : null;
      if (host && !(host in sites)) sites[host] = 'auto';
    }
  }
  if (Array.isArray(raw.disabledOrigins)) {
    for (const origin of raw.disabledOrigins) {
      const host = typeof origin === 'string' ? hostFromOrigin(origin) : null;
      if (host && !(host in sites)) sites[host] = 'off';
    }
  }

  return {
    defaultMode: isSiteMode(raw.defaultMode)
      ? raw.defaultMode
      : raw.enabledForAll === true
        ? 'auto'
        : DEFAULT_SETTINGS.defaultMode,
    sites,
    darkenImages: raw.darkenImages === true,
    imageSites,
  };
}

export async function loadSettings(): Promise<ForceDarkSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(result[SETTINGS_KEY]);
}

export async function saveSettings(
  settings: ForceDarkSettings,
): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export const SETTINGS_STORAGE_KEY = SETTINGS_KEY;

export function tabStateKey(tabId: number): string {
  return `tabTheme:${tabId}`;
}

export async function setTabThemeState(
  tabId: number,
  state: TabThemeState,
): Promise<void> {
  await browser.storage.session.set({ [tabStateKey(tabId)]: state });
}

export async function getTabThemeState(
  tabId: number,
): Promise<TabThemeState | null> {
  const key = tabStateKey(tabId);
  const result = await browser.storage.session.get(key);
  return (result[key] as TabThemeState | undefined) ?? null;
}

export async function clearTabThemeState(tabId: number): Promise<void> {
  await browser.storage.session.remove(tabStateKey(tabId));
}
