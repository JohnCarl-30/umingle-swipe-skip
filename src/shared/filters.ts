// Camera filters the user can apply to the video umingle sends.

/**
 * Looks (Photo Booth-style). `css` is applied while drawing; `post` names an
 * extra pixel effect run on the whole frame afterwards (see looks.ts).
 */
export const COLOR_FILTERS = {
  none: { label: 'None', css: 'none' },
  sepia: { label: 'Sepia', css: 'sepia(0.9) contrast(1.05)' },
  bw: { label: 'B&W', css: 'grayscale(1)' },
  plastic: { label: 'Plastic', css: 'saturate(1.5) contrast(1.15)', post: 'plastic' },
  comic: { label: 'Comic', css: 'saturate(1.8) contrast(1.3) brightness(1.1)', post: 'comic' },
  pencil: { label: 'Pencil', css: 'none', post: 'pencil' },
  glow: { label: 'Glow', css: 'brightness(1.1)', post: 'glow' },
  thermal: { label: 'Thermal', css: 'none', post: 'thermal' },
  xray: { label: 'X-Ray', css: 'grayscale(1) invert(1) contrast(1.3)', post: 'xray' },
  vintage: { label: 'Vintage', css: 'sepia(0.55) contrast(1.1) saturate(0.85) brightness(1.05)' },
  noir: { label: 'Noir', css: 'grayscale(1) contrast(1.5) brightness(0.9)' },
} as const;

export type LookPost = 'plastic' | 'comic' | 'pencil' | 'glow' | 'thermal' | 'xray';

export function lookPost(id: ColorFilterId): LookPost | null {
  const def = COLOR_FILTERS[id];
  return 'post' in def ? def.post : null;
}

export const BACKGROUNDS = {
  none: { label: 'None' },
  blur: { label: 'Blur' },
  studio: { label: 'Studio' },
} as const;

// Effects that cover the whole face were removed on purpose.
export const FACE_EFFECTS = {
  none: { label: 'None' },
  sunglasses: { label: '😎 Shades' },
  dog: { label: '🐶 Dog' },
  hearts: { label: '💕 Lovestruck' },
  birds: { label: '🐦 Dizzy' },
  bugout: { label: '👀 Bug Out' },
  chipmunk: { label: '🐿️ Chipmunk' },
  alien: { label: '👽 Space Alien' },
  twirl: { label: '🌀 Nose Twirl' },
  frog: { label: '🐸 Frog' },
} as const;

export type ColorFilterId = keyof typeof COLOR_FILTERS;
export type BackgroundId = keyof typeof BACKGROUNDS;
export type FaceEffectId = keyof typeof FACE_EFFECTS;

export interface FilterSettings {
  colorFilter: ColorFilterId;
  background: BackgroundId;
  faceEffect: FaceEffectId;
}

export const NO_FILTERS: FilterSettings = { colorFilter: 'none', background: 'none', faceEffect: 'none' };

export function filtersActive(f: FilterSettings): boolean {
  return f.colorFilter !== 'none' || f.background !== 'none' || f.faceEffect !== 'none';
}

/** Replaces saved values that no longer exist (e.g. removed effects) with 'none'. */
export function sanitizeFilters<T extends Partial<FilterSettings>>(f: T): T {
  const out = { ...f };
  if (out.colorFilter !== undefined && !(out.colorFilter in COLOR_FILTERS)) out.colorFilter = 'none';
  if (out.background !== undefined && !(out.background in BACKGROUNDS)) out.background = 'none';
  if (out.faceEffect !== undefined && !(out.faceEffect in FACE_EFFECTS)) out.faceEffect = 'none';
  return out;
}
