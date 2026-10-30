import type { Aspect, GifSettings } from './settings';

const ASPECT_RATIO: Record<Exclude<Aspect, 'original'>, number> = {
  '1:1': 1,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
};

export interface Layout {
  /** recorte na imagem original (corte centralizado) */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** tamanho final do GIF */
  width: number;
  height: number;
  /** onde o vídeo é desenhado dentro do quadro (só difere quando sobra espaço transparente) */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  transparent: boolean;
}

/** Calcula o enquadramento e o tamanho final. Nunca amplia além do vídeo original. */
export function computeLayout(videoW: number, videoH: number, s: Pick<GifSettings, 'aspect' | 'width'>): Layout {
  let sx = 0, sy = 0, sw = videoW, sh = videoH;
  if (s.aspect !== 'original') {
    const target = ASPECT_RATIO[s.aspect];
    if (videoW / videoH > target) {
      sw = Math.round(videoH * target);
      sx = Math.round((videoW - sw) / 2);
    } else {
      sh = Math.round(videoW / target);
      sy = Math.round((videoH - sh) / 2);
    }
  }
  const width = Math.max(2, Math.min(s.width, sw));
  const height = Math.max(2, Math.round((sh * width) / sw));
  return { sx, sy, sw, sh, width, height, dx: 0, dy: 0, dw: width, dh: height, transparent: false };
}

/** Figurinha: sempre 512×512. "cover" corta em quadrado; "contain" mostra o vídeo inteiro com sobras transparentes. */
export function stickerLayout(videoW: number, videoH: number, fit: GifSettings['stickerFit'], size = 512): Layout {
  if (fit === 'cover') {
    const side = Math.min(videoW, videoH);
    return {
      sx: Math.round((videoW - side) / 2), sy: Math.round((videoH - side) / 2), sw: side, sh: side,
      width: size, height: size, dx: 0, dy: 0, dw: size, dh: size, transparent: false,
    };
  }
  const scale = size / Math.max(videoW, videoH);
  const dw = Math.round(videoW * scale), dh = Math.round(videoH * scale);
  return {
    sx: 0, sy: 0, sw: videoW, sh: videoH,
    width: size, height: size, dx: Math.round((size - dw) / 2), dy: Math.round((size - dh) / 2), dw, dh, transparent: true,
  };
}

/** Enquadramento conforme o tipo de saída escolhido. */
export function layoutFor(videoW: number, videoH: number, s: GifSettings): Layout {
  return s.output === 'sticker' ? stickerLayout(videoW, videoH, s.stickerFit) : computeLayout(videoW, videoH, s);
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Filtros aplicados direto nos pixels — funciona igual em todos os navegadores
 * (o ctx.filter do canvas não existe em parte dos navegadores de celular).
 */
export function applyPixelEffects(data: Uint8ClampedArray, s: Pick<GifSettings, 'filter' | 'brightness' | 'contrast'>) {
  const { filter } = s;
  const b = s.brightness * 2.55;
  const c = s.contrast;
  const cf = (259 * (c * 2.55 + 255)) / (255 * (259 - c * 2.55));
  const tone = b !== 0 || c !== 0;
  if (filter === 'nenhum' && !tone) return;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], bl = data[i + 2];

    switch (filter) {
      case 'pb': {
        const y = 0.299 * r + 0.587 * g + 0.114 * bl;
        r = g = bl = y;
        break;
      }
      case 'sepia': {
        const nr = 0.393 * r + 0.769 * g + 0.189 * bl;
        const ng = 0.349 * r + 0.686 * g + 0.168 * bl;
        const nb = 0.272 * r + 0.534 * g + 0.131 * bl;
        r = nr; g = ng; bl = nb;
        break;
      }
      case 'vibrante': {
        const avg = (r + g + bl) / 3;
        r = avg + (r - avg) * 1.45;
        g = avg + (g - avg) * 1.45;
        bl = avg + (bl - avg) * 1.45;
        break;
      }
      case 'retro': {
        // tons quentes e pretos "lavados", como filme antigo
        r = r * 0.9 + 30;
        g = g * 0.85 + 18;
        bl = bl * 0.7 + 10;
        break;
      }
      case 'negativo':
        r = 255 - r; g = 255 - g; bl = 255 - bl;
        break;
    }

    if (tone) {
      r = cf * (r + b - 128) + 128;
      g = cf * (g + b - 128) + 128;
      bl = cf * (bl + b - 128) + 128;
    }
    data[i] = clamp(r);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(bl);
  }
}

/** Escreve a legenda estilo meme: letra grossa, contorno escuro, quebra de linha automática. */
export function drawCaption(ctx: CanvasRenderingContext2D, width: number, height: number, s: Pick<GifSettings, 'text' | 'textPosition' | 'textSize' | 'textColor'>) {
  const text = s.text.trim();
  if (!text) return;
  const size = Math.max(10, Math.round((height * s.textSize) / 100));
  ctx.save();
  ctx.font = `900 ${size}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.fillStyle = s.textColor;
  ctx.strokeStyle = isLight(s.textColor) ? '#000' : '#fff';
  ctx.lineWidth = Math.max(2, size / 7);

  const maxW = width * 0.92;
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }

  const lineH = size * 1.08;
  const pad = Math.round(height * 0.04);
  const startY = s.textPosition === 'top' ? pad + size : height - pad - (lines.length - 1) * lineH;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => {
    const y = startY + i * lineH;
    ctx.strokeText(l, width / 2, y, maxW);
    ctx.fillText(l, width / 2, y, maxW);
  });
  ctx.restore();
}

function isLight(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

/** Desenha um quadro completo (enquadramento + filtros + legenda). Usado na prévia e na conversão. */
export function renderFrame(ctx: CanvasRenderingContext2D, source: CanvasImageSource, layout: Layout, s: GifSettings) {
  if (layout.transparent) ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.drawImage(source, layout.sx, layout.sy, layout.sw, layout.sh, layout.dx, layout.dy, layout.dw, layout.dh);
  if (s.filter !== 'nenhum' || s.brightness !== 0 || s.contrast !== 0) {
    const img = ctx.getImageData(0, 0, layout.width, layout.height);
    applyPixelEffects(img.data, s);
    ctx.putImageData(img, 0, 0);
  }
  drawCaption(ctx, layout.width, layout.height, s);
}
