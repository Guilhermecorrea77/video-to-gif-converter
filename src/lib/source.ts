/**
 * Abre o arquivo escolhido, seja vídeo, GIF, WebP/PNG animado ou foto,
 * e o transforma numa "fonte" com a qual o editor e a conversão sabem trabalhar.
 */
import { GifReader } from 'omggif';
import { createHiddenVideo, waitForMetadata } from './convert';

export type Source =
  | { kind: 'video'; file: File; url: string; duration: number; width: number; height: number }
  | {
      kind: 'frames';
      file: File;
      /** quadros já compostos (imagem completa), na ordem */
      frames: ImageBitmap[];
      /** instante (s) em que cada quadro começa */
      times: number[];
      duration: number;
      width: number;
      height: number;
      /** false = foto/imagem parada (um quadro só) */
      animated: boolean;
    };

/** Maior lado guardado na memória: suficiente para GIF (até 800 px) e figurinha (512 px). */
const MAX_SIDE = 960;
const MAX_FRAMES = 600;

export const ACCEPT = 'video/*,image/gif,image/webp,image/png,image/apng,image/jpeg,image/avif,.mov,.mkv,.gif,.webp,.png,.apng,.jpg,.jpeg';

type Kind = 'video' | 'animated' | 'image' | null;

export function detectKind(f: File): Kind {
  const t = f.type.toLowerCase();
  const n = f.name.toLowerCase();
  if (t.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|ogv|3gp)$/.test(n)) return 'video';
  if (t === 'image/gif' || t === 'image/webp' || t === 'image/apng' || /\.(gif|webp|apng)$/.test(n)) return 'animated';
  if (t === 'image/png' || /\.png$/.test(n)) return 'animated'; // PNG pode ser animado (APNG)
  if (t.startsWith('image/') || /\.(jpe?g|avif|bmp)$/.test(n)) return 'image';
  return null;
}

export const isSupportedFile = (f: File) => detectKind(f) !== null;

export function frameAt(src: Extract<Source, { kind: 'frames' }>, t: number): ImageBitmap {
  const { times, frames } = src;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t + 1e-6) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
}

export function releaseSource(src: Source | null) {
  if (!src) return;
  if (src.kind === 'video') URL.revokeObjectURL(src.url);
  else src.frames.forEach((b) => b.close());
}

function fitSize(w: number, h: number) {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

async function toBitmap(img: ImageBitmapSource, w: number, h: number) {
  const t = fitSize(w, h);
  if (t.w === w && t.h === h) return createImageBitmap(img);
  return createImageBitmap(img, { resizeWidth: t.w, resizeHeight: t.h, resizeQuality: 'high' });
}

function tooMany(n: number) {
  return new Error(`Esta animação tem ${n} quadros; o limite é ${MAX_FRAMES}. Use um GIF menor ou um vídeo.`);
}

/** Decodificador nativo do navegador (Chrome/Edge/Android): lê GIF, WebP e PNG animados. */
async function decodeWithImageDecoder(file: File): Promise<Extract<Source, { kind: 'frames' }> | null> {
  const ID = (window as unknown as { ImageDecoder?: any }).ImageDecoder;
  if (!ID || !file.type) return null;
  try {
    if (!(await ID.isTypeSupported(file.type))) return null;
    const decoder = new ID({ data: await file.arrayBuffer(), type: file.type });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const count: number = track?.frameCount ?? 1;
    if (count > MAX_FRAMES) throw tooMany(count);
    const frames: ImageBitmap[] = [];
    const times: number[] = [];
    let t = 0, width = 0, height = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      width = image.displayWidth;
      height = image.displayHeight;
      frames.push(await toBitmap(image, width, height));
      times.push(t);
      // duração em microssegundos; navegadores tratam < 20 ms como 100 ms
      const ms = (image.duration ?? 100_000) / 1000;
      t += (ms < 20 ? 100 : ms) / 1000;
      image.close();
    }
    decoder.close();
    return { kind: 'frames', file, frames, times, duration: count > 1 ? t : 0, width: frames[0].width, height: frames[0].height, animated: count > 1 };
  } catch (e) {
    if (e instanceof Error && e.message.includes('limite')) throw e;
    return null;
  }
}

/** Plano B para GIF em navegadores sem ImageDecoder (Firefox, Safari): decodifica em JavaScript. */
async function decodeGifInJs(file: File): Promise<Extract<Source, { kind: 'frames' }>> {
  const reader = new GifReader(new Uint8Array(await file.arrayBuffer()));
  const { width, height } = reader;
  const count = reader.numFrames();
  if (count > MAX_FRAMES) throw tooMany(count);

  const canvas = new Uint8ClampedArray(width * height * 4);
  const frames: ImageBitmap[] = [];
  const times: number[] = [];
  let t = 0;
  let previous: Uint8ClampedArray | null = null;

  for (let i = 0; i < count; i++) {
    const info = reader.frameInfo(i);
    if (info.disposal === 3) previous = canvas.slice(); // "voltar ao anterior" depois deste quadro
    reader.decodeAndBlitFrameRGBA(i, canvas as unknown as Uint8Array);
    frames.push(await toBitmap(new ImageData(canvas.slice(), width, height), width, height));
    times.push(t);
    const cs = info.delay || 10;
    t += (cs < 2 ? 10 : cs) / 100;

    // prepara a tela para o próximo quadro conforme a regra de descarte deste
    if (info.disposal === 2) {
      for (let y = info.y; y < info.y + info.height; y++) {
        canvas.fill(0, (y * width + info.x) * 4, (y * width + info.x + info.width) * 4);
      }
    } else if (info.disposal === 3 && previous) {
      canvas.set(previous);
    }
  }
  return { kind: 'frames', file, frames, times, duration: count > 1 ? t : 0, width: frames[0].width, height: frames[0].height, animated: count > 1 };
}

async function decodeStill(file: File): Promise<Extract<Source, { kind: 'frames' }>> {
  const raw = await createImageBitmap(file);
  const bmp = await toBitmap(raw, raw.width, raw.height);
  if (bmp !== raw) raw.close();
  return { kind: 'frames', file, frames: [bmp], times: [0], duration: 0, width: bmp.width, height: bmp.height, animated: false };
}

export async function loadSource(file: File): Promise<Source> {
  const kind = detectKind(file);
  if (!kind) throw new Error(`“${file.name}” não é um formato aceito. Use vídeo (MP4, MOV, WebM), GIF, WebP, PNG ou JPG.`);

  if (kind === 'video') {
    const url = URL.createObjectURL(file);
    const probe = createHiddenVideo(url);
    try {
      await waitForMetadata(probe);
      const duration = probe.duration;
      if (!isFinite(duration) || duration <= 0) throw new Error('Não foi possível ler a duração deste vídeo. Tente outro arquivo.');
      return { kind: 'video', file, url, duration, width: probe.videoWidth, height: probe.videoHeight };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    } finally {
      probe.remove();
    }
  }

  try {
    if (kind === 'animated') {
      const native = await decodeWithImageDecoder(file);
      if (native) return native;
      if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) return await decodeGifInJs(file);
    }
    // Sem decodificador de animação (ex.: WebP animado no Safari): usa o primeiro quadro
    return await decodeStill(file);
  } catch (e) {
    if (e instanceof Error && e.message.includes('limite')) throw e;
    throw new Error(`Não foi possível abrir “${file.name}”. O arquivo pode estar corrompido ou num formato que este navegador não lê.`);
  }
}

/** Miniaturas da linha do tempo para animações já decodificadas. */
export function frameThumbnails(src: Extract<Source, { kind: 'frames' }>, count: number, height = 56): string[] {
  const c = document.createElement('canvas');
  c.height = height * 2;
  c.width = Math.round((c.height * src.width) / src.height);
  const ctx = c.getContext('2d');
  if (!ctx) return [];
  return Array.from({ length: count }, (_, i) => {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(frameAt(src, ((i + 0.5) / count) * src.duration), 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  });
}
