// Typed wrapper around chrome.storage.local for the extension's settings.

export type Sensitivity = 1 | 2 | 3 | 4 | 5;

export interface PanelPosition {
  left: number;
  top: number;
}

export interface StoredSettings {
  enabled: boolean;
  sensitivity: Sensitivity;
  collapsed: boolean;
  skipSelector: string | null;
  panelPos: PanelPosition | null;
}

export const DEFAULT_SETTINGS: StoredSettings = {
  enabled: true,
  sensitivity: 3,
  collapsed: false,
  skipSelector: null,
  panelPos: null,
};

export async function loadSettings<K extends keyof StoredSettings>(
  keys: readonly K[],
): Promise<Pick<StoredSettings, K>> {
  const defaults = Object.fromEntries(keys.map((k) => [k, DEFAULT_SETTINGS[k]])) as Pick<StoredSettings, K>;
  try {
    const stored = (await chrome.storage.local.get([...keys])) as Partial<Pick<StoredSettings, K>>;
    return { ...defaults, ...stored };
  } catch {
    return defaults; // storage unavailable: keep defaults
  }
}

export function saveSetting<K extends keyof StoredSettings>(key: K, value: StoredSettings[K]): void {
  chrome.storage.local.set({ [key]: value }).catch(() => {});
}
