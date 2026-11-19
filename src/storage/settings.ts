export interface ForceDarkSettings {
  enabledForAll: boolean;
  disabledOrigins: string[];
  enabledOrigins: string[];
}

export const DEFAULT_SETTINGS: ForceDarkSettings = {
  enabledForAll: true,
  disabledOrigins: [],
  enabledOrigins: [],
};

export type PageThemeStatus =
  | 'native'
  | 'recolor'
  | 'filter'
  | 'off'
  | 'blocked'
  | 'idle';

export interface TabThemeState {
  status: PageThemeStatus;
  origin: string;
  updatedAt: number;
}

const SETTINGS_KEY = 'forceDarkSettings';

export function isOriginEnabled(
  settings: ForceDarkSettings,
  origin: string,
): boolean {
  if (!origin) return false;
  if (settings.enabledForAll) {
    return !settings.disabledOrigins.includes(origin);
  }
  return settings.enabledOrigins.includes(origin);
}

export function setOriginEnabled(
  settings: ForceDarkSettings,
  origin: string,
  enabled: boolean,
): ForceDarkSettings {
  const disabled = new Set(settings.disabledOrigins);
  const enabledSet = new Set(settings.enabledOrigins);

  if (settings.enabledForAll) {
    if (enabled) {
      disabled.delete(origin);
    } else {
      disabled.add(origin);
    }
  } else if (enabled) {
    enabledSet.add(origin);
  } else {
    enabledSet.delete(origin);
  }

  return {
    ...settings,
    disabledOrigins: [...disabled].sort(),
    enabledOrigins: [...enabledSet].sort(),
  };
}

export function setEnabledForAll(
  settings: ForceDarkSettings,
  enabledForAll: boolean,
): ForceDarkSettings {
  return {
    ...settings,
    enabledForAll,
  };
}

export async function loadSettings(): Promise<ForceDarkSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<ForceDarkSettings> | undefined;
  return {
    enabledForAll: stored?.enabledForAll ?? DEFAULT_SETTINGS.enabledForAll,
    disabledOrigins: stored?.disabledOrigins ?? [],
    enabledOrigins: stored?.enabledOrigins ?? [],
  };
}

export async function saveSettings(
  settings: ForceDarkSettings,
): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

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
