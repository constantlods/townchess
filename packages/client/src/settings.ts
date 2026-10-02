import type { Cosmetics } from '@hc/shared';
import { DEFAULT_COSMETICS } from '@hc/shared';
import type { EnvId } from './scene/environment';
import type { Quality } from './render/post';

export type AnimationMode = 'cinematic' | 'standard' | 'competitive';

export interface Settings {
  reducedMotion: boolean;
  reducedHorror: boolean;
  reducedCamera: boolean;
  highContrastPieces: boolean;
  largerBoard: boolean;
  simplifiedEnvironment: boolean;
  sfxVolume: number;
  ambienceVolume: number;
  musicVolume: number;
  animationMode: AnimationMode;
  quality: Quality;
  depthOfField: boolean;
  showMoveHints: boolean;
  environment: EnvId;
  cosmetics: Cosmetics;
  username: string;
}

const KEY = 'horror-chess.settings.v1';

function defaultQuality(): Quality {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(innerWidth, innerHeight) < 600;
  return mobile ? 'low' : 'high';
}

export const DEFAULTS: Settings = {
  reducedMotion: false,
  reducedHorror: false,
  reducedCamera: false,
  highContrastPieces: false,
  largerBoard: false,
  simplifiedEnvironment: false,
  sfxVolume: 0.8,
  ambienceVolume: 0.55,
  musicVolume: 0.35,
  animationMode: 'standard',
  quality: 'high',
  depthOfField: true,
  showMoveHints: true,
  environment: 'institutional',
  cosmetics: { ...DEFAULT_COSMETICS },
  username: 'PATIENT_07',
};

export function loadSettings(): Settings {
  let stored: Partial<Settings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch { /* storage unavailable: defaults */ }
  const s = { ...DEFAULTS, quality: defaultQuality(), ...stored };
  s.cosmetics = { ...DEFAULT_COSMETICS, ...(stored.cosmetics ?? {}) };
  if (matchMedia?.('(prefers-reduced-motion: reduce)').matches && stored.reducedMotion === undefined) s.reducedMotion = true;
  return s;
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** Duration multiplier for physical move animations. 0 => instant. */
export function animScale(s: Settings): number {
  if (s.animationMode === 'competitive') return 0;
  if (s.reducedMotion) return 0.45;
  return s.animationMode === 'cinematic' ? 1.6 : 1;
}
