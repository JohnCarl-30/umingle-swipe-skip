// Typed wrapper around chrome.storage.local for the extension's settings.
import { NO_FILTERS, sanitizeFilters, type FilterSettings } from './filters';

export type Sensitivity = 1 | 2 | 3 | 4 | 5;

export interface PanelPosition {
  left: number;
  top: number;
}

export type PanelTab = 'skip' | 'filters' | 'scare';
/** 'hand' = any hand shown briefly; 'wave' = a side-to-side wave. */
export type ScareTrigger = 'hand' | 'wave';

export interface StoredSettings extends FilterSettings {
  enabled: boolean;
  swipe: boolean;      // swipe right skips
  thumbsDown: boolean; // 👎 held skips
  sensitivity: Sensitivity;
  collapsed: boolean;
  tab: PanelTab;
  scare: boolean;              // jumpscare on the stranger's hand
  scareTrigger: ScareTrigger;
  scareVolume: number;         // 0..1
  scareImage: string | null;   // data: URL, or null for the default image
  scareSound: string | null;   // data: URL, or null for the generated scream
  skipSelector: string | null;
  panelPos: PanelPosition | null;
}

export const DEFAULT_SETTINGS: StoredSettings = {
  enabled: true,
  swipe: true,
  thumbsDown: true,
  sensitivity: 3,
  collapsed: false,
  tab: 'skip',
  scare: false,
  scareTrigger: 'hand',
  scareVolume: 0.8,
  scareImage: null,
  scareSound: null,
  skipSelector: null,
  panelPos: null,
  ...NO_FILTERS,
};

export const FILTER_KEYS = ['colorFilter', 'background', 'faceEffect'] as const;

export async function loadSettings<K extends keyof StoredSettings>(
  keys: readonly K[],
): Promise<Pick<StoredSettings, K>> {
  const defaults = Object.fromEntries(keys.map((k) => [k, DEFAULT_SETTINGS[k]])) as Pick<StoredSettings, K>;
  try {
    const stored = (await chrome.storage.local.get([...keys])) as Partial<Pick<StoredSettings, K>>;
    return sanitizeFilters({ ...defaults, ...stored });
  } catch {
    return defaults; // storage unavailable: keep defaults
  }
}

export function saveSetting<K extends keyof StoredSettings>(key: K, value: StoredSettings[K]): void {
  chrome.storage.local.set({ [key]: value }).catch(() => {});
}
