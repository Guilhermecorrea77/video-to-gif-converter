/** Tudo o que a pessoa ajusta antes de converter. */
export type Aspect = 'original' | '1:1' | '4:5' | '9:16' | '16:9';
export type Filter = 'nenhum' | 'pb' | 'sepia' | 'vibrante' | 'retro' | 'negativo';
export type Direction = 'normal' | 'reverso' | 'vaivem';
export type TextPosition = 'top' | 'bottom';

export interface GifSettings {
  fps: number;
  width: number;
  colors: number;
  speed: number;
  aspect: Aspect;
  filter: Filter;
  brightness: number; // -50..50
  contrast: number; // -50..50
  direction: Direction;
  /** 0 = infinito, -1 = toca uma vez, n = repete n vezes */
  repeat: number;
  text: string;
  textPosition: TextPosition;
  textSize: number; // % da altura
  textColor: string;
}

export const DEFAULT_SETTINGS: GifSettings = {
  fps: 12,
  width: 480,
  colors: 256,
  speed: 1,
  aspect: 'original',
  filter: 'nenhum',
  brightness: 0,
  contrast: 0,
  direction: 'normal',
  repeat: 0,
  text: '',
  textPosition: 'bottom',
  textSize: 12,
  textColor: '#ffffff',
};

/** Atalhos prontos para quem não quer mexer em cada controle. */
export const PRESETS: { id: string; label: string; hint: string; values: Partial<GifSettings> }[] = [
  { id: 'whatsapp', label: 'WhatsApp', hint: 'Leve, abre rápido no celular', values: { fps: 10, width: 320, colors: 128 } },
  { id: 'equilibrado', label: 'Equilibrado', hint: 'Bom para a maioria dos usos', values: { fps: 12, width: 480, colors: 256 } },
  { id: 'qualidade', label: 'Alta qualidade', hint: 'Mais fluido, arquivo maior', values: { fps: 20, width: 640, colors: 256 } },
];

export const LIMITS = {
  /** Acima disso o navegador do celular costuma travar por falta de memória */
  maxFrames: 600,
  maxSegmentSeconds: 60,
};

const KEY = 'video-to-gif:settings:v1';

export function loadSettings(): GifSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), text: '' };
  } catch {
    /* sem armazenamento: usa o padrão */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: GifSettings) {
  try {
    // O texto é específico de cada GIF; não faz sentido lembrar
    localStorage.setItem(KEY, JSON.stringify({ ...s, text: '' }));
  } catch {
    /* ignora */
  }
}

/** Quantos quadros saem do trecho escolhido, já considerando velocidade e direção. */
export function frameCount(segmentSeconds: number, s: Pick<GifSettings, 'fps' | 'speed' | 'direction'>) {
  const base = Math.max(1, Math.floor((segmentSeconds / s.speed) * s.fps));
  return s.direction === 'vaivem' ? Math.max(1, base * 2 - 2) : base;
}
