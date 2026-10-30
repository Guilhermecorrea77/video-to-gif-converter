import { layoutFor, renderFrame, type Layout } from './render';
import { LIMITS, STICKER, effectiveFps, frameCount, type GifSettings } from './settings';
import { buildAnimatedWebP, canEncodeWebP, canvasToWebP } from './webp';
import type { WorkerIn, WorkerOut } from '../workers/gif.worker';

export interface ConvertResult {
  blob: Blob;
  width: number;
  height: number;
  frames: number;
  seconds: number;
}

export interface ConvertProgress {
  phase: 'lendo' | 'montando';
  value: number; // 0..1 no total
}

export class CancelledError extends Error {
  constructor() {
    super('Conversão cancelada.');
    this.name = 'CancelledError';
  }
}

/**
 * Cria um <video> preso ao DOM e DENTRO da tela (quase invisível).
 * No celular, vídeos fora da tela ou nunca tocados deixam de decodificar quadros:
 * o Chrome do Android pausa vídeos mudos fora da área visível e o Safari do iPhone
 * só entrega a imagem nova depois do primeiro play().
 */
export function createHiddenVideo(url: string) {
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  video.src = url;
  Object.assign(video.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '2px',
    height: '2px',
    opacity: '0.01',
    pointerEvents: 'none',
    zIndex: '-1',
  });
  document.body.appendChild(video);
  return video;
}

/** Toca e pausa uma vez: "acorda" o decodificador do celular antes de buscar quadros. */
export async function primeVideo(video: HTMLVideoElement) {
  try {
    await video.play();
  } catch {
    /* sem permissão para tocar: segue mesmo assim */
  }
  video.pause();
  if (video.readyState < 2) {
    await new Promise<void>((r) => {
      const t = setTimeout(r, 1500);
      video.addEventListener('loadeddata', () => (clearTimeout(t), r()), { once: true });
    });
  }
}

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/** Vídeos em que o aviso de "quadro apresentado" não chega após buscar: não vale esperar de novo. */
const noFrameCallback = new WeakSet<HTMLVideoElement>();

/**
 * Espera o navegador realmente apresentar o quadro novo (quando ele sabe avisar).
 * Se o aviso não vier na primeira tentativa, desiste para esse vídeo e não atrasa os próximos quadros.
 */
function waitForPresentedFrame(video: FrameVideo, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    if (!video.requestVideoFrameCallback || noFrameCallback.has(video)) return resolve();
    let id = 0;
    const t = setTimeout(() => {
      video.cancelVideoFrameCallback?.(id);
      noFrameCallback.add(video);
      resolve();
    }, timeoutMs);
    id = video.requestVideoFrameCallback(() => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** Assinatura rápida de um quadro (amostra ~1.000 pixels) para detectar imagens repetidas. */
function frameSignature(data: Uint8ClampedArray) {
  let h = 2166136261;
  const stride = Math.max(4, Math.floor(data.length / 4 / 1000) * 4);
  for (let i = 0; i < data.length; i += stride) {
    h = Math.imul(h ^ data[i], 16777619);
    h = Math.imul(h ^ data[i + 1], 16777619);
    h = Math.imul(h ^ data[i + 2], 16777619);
  }
  return h >>> 0;
}

export function waitForMetadata(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    if (video.readyState >= 1) return resolve();
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Não foi possível abrir este vídeo. Tente um MP4 (H.264) ou WebM.')), { once: true });
  });
}

/** Busca um instante exato e espera o quadro ficar pronto para desenhar. */
export function seekTo(video: HTMLVideoElement, time: number, waitFrame = false) {
  return new Promise<void>((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return resolve();
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', finish);
      if (waitFrame) await waitForPresentedFrame(video, 150);
      resolve();
    };
    // Algumas WebViews nunca disparam "seeked": segue depois de 1,5 s
    const timer = setTimeout(finish, 1500);
    video.addEventListener('seeked', finish);
    video.currentTime = time;
  });
}

export interface ReadOptions {
  file: File;
  start: number;
  end: number;
  settings: GifSettings;
  signal: AbortSignal;
  /** chamado a cada quadro pronto no canvas; pode demorar (controle de fila) */
  onFrame: (canvas: HTMLCanvasElement, data: ImageData) => Promise<void> | void;
  /** os quadros lidos até aqui devem ser descartados (vamos ler de novo de outro jeito) */
  onReset: () => Promise<void> | void;
  onProgress: (value: number) => void;
}

/**
 * Lê os quadros do trecho já com enquadramento, filtros e legenda.
 * 1) busca cada instante (rápido); 2) se os primeiros quadros vierem iguais,
 * busca de novo esperando cada imagem; 3) se ainda falhar (comum no celular),
 * toca o trecho e captura os quadros enquanto ele passa.
 */
export async function readFrames(o: ReadOptions): Promise<{ layout: Layout; frames: number }> {
  const { settings, signal } = o;
  const url = URL.createObjectURL(o.file);
  const video = createHiddenVideo(url);
  try {
    await waitForMetadata(video);
    const s0 = Math.max(0, o.start);
    const s1 = Math.min(video.duration, o.end);
    const seconds = s1 - s0;
    if (!(seconds > 0)) throw new Error('Escolha um trecho com pelo menos 0,1 s.');

    const total = frameCount(seconds, { ...settings, direction: 'normal' });
    if (total > LIMITS.maxFrames) {
      throw new Error(
        `Esse trecho geraria ${total} quadros (o limite é ${LIMITS.maxFrames}). Encurte o trecho, reduza os quadros por segundo ou aumente a velocidade.`
      );
    }

    const layout = layoutFor(video.videoWidth, video.videoHeight, settings);
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Seu navegador não permitiu desenhar os quadros (canvas indisponível).');

    // A velocidade muda o intervalo entre as amostras do vídeo, não o atraso do quadro
    // (navegadores travam atrasos de GIF menores que 20 ms em 100 ms).
    const step = settings.speed / effectiveFps(settings);
    const targetTime = (i: number) => Math.min(s1 - 0.001, s0 + i * step);
    let count = 0;

    const capture = async () => {
      renderFrame(ctx, video, layout, settings);
      const data = ctx.getImageData(0, 0, layout.width, layout.height);
      const sig = frameSignature(data.data);
      await o.onFrame(canvas, data);
      count++;
      return sig;
    };

    await primeVideo(video);

    const PROBE = Math.min(6, total);
    let seekingWorks = true;
    for (const waitFrame of [false, true]) {
      const probe = new Set<number>();
      let repeated = false;
      for (let i = 0; i < total; i++) {
        if (signal.aborted) throw new CancelledError();
        await seekTo(video, targetTime(i), waitFrame);
        const sig = await capture();
        if (i < PROBE) probe.add(sig);
        if (i === PROBE - 1 && PROBE >= 4 && probe.size === 1) {
          repeated = true;
          break;
        }
        o.onProgress((i + 1) / total);
      }
      if (!repeated) break;
      await o.onReset();
      count = 0;
      if (waitFrame) seekingWorks = false;
    }

    if (!seekingWorks) {
      console.info('[gif] a busca de quadros não trouxe imagens novas; capturando durante a reprodução');
      o.onProgress(0);
      await capturePlaying(video as FrameVideo, s0, s1, total, targetTime, async () => {
        const wasPlaying = !video.paused;
        video.pause(); // pausa enquanto processa o quadro: nada se perde se o celular for lento
        await capture();
        o.onProgress(count / total);
        if (wasPlaying) await video.play().catch(() => {});
      }, signal);
      if (signal.aborted) throw new CancelledError();
    }

    return { layout, frames: count };
  } finally {
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------
export async function convertVideoToGif(
  file: File,
  start: number,
  end: number,
  settings: GifSettings,
  onProgress: (p: ConvertProgress) => void,
  signal: AbortSignal
): Promise<ConvertResult> {
  const worker = new Worker(new URL('../workers/gif.worker.ts', import.meta.url), { type: 'module' });
  let acked = 0;
  let sent = 0;
  let ackWaiter: (() => void) | null = null;
  let finishResolve: ((r: { buffer: ArrayBuffer; frames: number }) => void) | null = null;
  let failReject: ((e: Error) => void) | null = null;
  const state: { failure: Error | null } = { failure: null };
  const MAX_IN_FLIGHT = 3;

  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const m = e.data;
    if (m.type === 'ack') {
      acked = m.count;
      ackWaiter?.();
    } else if (m.type === 'progress') {
      onProgress({ phase: 'montando', value: 0.9 + m.value * 0.1 });
    } else if (m.type === 'done') {
      finishResolve?.(m);
    } else if (m.type === 'error') {
      state.failure = new Error(`Falha ao montar o GIF: ${m.message}`);
      failReject?.(state.failure);
      ackWaiter?.();
    }
  };
  const send = (msg: WorkerIn, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);
  signal.addEventListener('abort', () => ackWaiter?.(), { once: true });

  const waitAcks = async (upTo: number) => {
    while (acked < upTo && !state.failure && !signal.aborted) {
      await new Promise<void>((r) => (ackWaiter = r));
      ackWaiter = null;
    }
    if (signal.aborted) throw new CancelledError();
    if (state.failure) throw state.failure;
  };

  let initialized = false;
  const init = (w: number, h: number) => {
    send({ type: 'init', width: w, height: h, colors: settings.colors });
    acked = 0;
    sent = 0;
    initialized = true;
  };

  try {
    const { layout } = await readFrames({
      file, start, end, settings, signal,
      onFrame: async (_canvas, data) => {
        if (!initialized) init(data.width, data.height);
        send({ type: 'frame', buffer: data.data.buffer }, [data.data.buffer]);
        sent++;
        await waitAcks(sent - MAX_IN_FLIGHT); // não deixa a fila crescer (memória do celular)
      },
      onReset: async () => {
        await waitAcks(sent);
        initialized = false;
      },
      onProgress: (v) => onProgress({ phase: 'lendo', value: v * 0.9 }),
    });

    await waitAcks(sent);
    onProgress({ phase: 'montando', value: 0.9 });
    const result = await new Promise<{ buffer: ArrayBuffer; frames: number }>((resolve, reject) => {
      finishResolve = resolve;
      failReject = reject;
      signal.addEventListener('abort', () => reject(new CancelledError()), { once: true });
      send({ type: 'finish', fps: settings.fps, direction: settings.direction, repeat: settings.repeat });
    });

    onProgress({ phase: 'montando', value: 1 });
    return {
      blob: new Blob([result.buffer], { type: 'image/gif' }),
      width: layout.width,
      height: layout.height,
      frames: result.frames,
      seconds: result.frames / settings.fps,
    };
  } finally {
    worker.terminate();
  }
}

// ---------------------------------------------------------------------------
// Figurinha animada do WhatsApp (WebP 512×512, até 500 KB e 10 s)
// ---------------------------------------------------------------------------
export interface StickerResult extends ConvertResult {
  /** true se mesmo no mínimo de qualidade passou de 500 KB */
  overLimit: boolean;
  quality: number;
}

/** Ordem final dos quadros conforme a direção escolhida. */
function orderFrames<T>(frames: T[], direction: GifSettings['direction']): T[] {
  if (direction === 'reverso') return [...frames].reverse();
  if (direction === 'vaivem' && frames.length > 2) return [...frames, ...frames.slice(1, -1).reverse()];
  return frames;
}

/** Durações em ms arredondadas sobre o tempo acumulado (sem deriva). */
function durationsMs(count: number, fps: number) {
  return Array.from({ length: count }, (_, i) => Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps));
}

export async function convertVideoToSticker(
  file: File,
  start: number,
  end: number,
  settings: GifSettings,
  onProgress: (p: ConvertProgress) => void,
  signal: AbortSignal
): Promise<StickerResult> {
  if (!canEncodeWebP()) {
    throw new Error('Este navegador não consegue gerar figurinhas (WebP). No iPhone, use o GIF; no computador ou Android, use Chrome, Edge ou Firefox.');
  }
  const fps = effectiveFps(settings);

  // 1ª passada: guarda cada quadro em WebP de alta qualidade (ocupa pouca memória)
  let masters: Blob[] = [];
  const { layout } = await readFrames({
    file, start, end, settings, signal,
    onFrame: async (canvas) => {
      masters.push(await canvasToWebP(canvas, 0.92));
    },
    onReset: () => {
      masters = [];
    },
    onProgress: (v) => onProgress({ phase: 'lendo', value: v * 0.7 }),
  });

  const ordered = orderFrames(masters, settings.direction);
  if (ordered.length / fps > STICKER.maxSeconds + 0.01) {
    throw new Error(`A figurinha pode ter no máximo ${STICKER.maxSeconds} s. Encurte o trecho ou aumente a velocidade.`);
  }

  // 2ª passada: recodifica até caber em 500 KB (baixa qualidade; se preciso, descarta quadros)
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d')!;
  const bitmaps = new Map<Blob, ImageBitmap>();
  const bitmapOf = async (b: Blob) => {
    let bm = bitmaps.get(b);
    if (!bm) bitmaps.set(b, (bm = await createImageBitmap(b)));
    return bm;
  };

  const qualities = [0.8, 0.65, 0.5, 0.38, 0.28, 0.2];
  const plans: { keepEvery: number; quality: number }[] = [];
  for (const keepEvery of [1, 2, 3]) for (const q of qualities) plans.push({ keepEvery, quality: q });

  let best: { blob: Blob; frames: number; quality: number; seconds: number } | null = null;
  try {
    for (let p = 0; p < plans.length; p++) {
      if (signal.aborted) throw new CancelledError();
      const { keepEvery, quality } = plans[p];
      const picked = ordered.filter((_, i) => i % keepEvery === 0);
      const encoded = new Map<Blob, Blob>();
      const frames: Blob[] = [];
      for (const m of picked) {
        let e = encoded.get(m);
        if (!e) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(await bitmapOf(m), 0, 0);
          e = await canvasToWebP(canvas, quality);
          encoded.set(m, e);
        }
        frames.push(e);
      }
      const durations = durationsMs(ordered.length, fps);
      // ao descartar quadros, cada quadro mantido passa a durar a soma dos descartados
      const merged = picked.map((_, k) => durations.slice(k * keepEvery, k * keepEvery + keepEvery).reduce((a, b) => a + b, 0));
      const blob = await buildAnimatedWebP(frames, merged, layout.width, layout.height, layout.transparent, 0);
      best = { blob, frames: frames.length, quality, seconds: merged.reduce((a, b) => a + b, 0) / 1000 };
      onProgress({ phase: 'montando', value: 0.7 + (0.3 * (p + 1)) / plans.length });
      if (blob.size <= STICKER.maxBytes) break;
    }
  } finally {
    bitmaps.forEach((b) => b.close());
  }

  onProgress({ phase: 'montando', value: 1 });
  return {
    blob: best!.blob,
    width: layout.width,
    height: layout.height,
    frames: best!.frames,
    seconds: best!.seconds,
    overLimit: best!.blob.size > STICKER.maxBytes,
    quality: best!.quality,
  };
}

/**
 * Plano B para celulares: toca o trecho em tempo real e captura um quadro sempre
 * que o vídeo passa pelo próximo instante desejado.
 */
async function capturePlaying(
  video: FrameVideo,
  s0: number,
  s1: number,
  total: number,
  targetTime: (i: number) => number,
  onFrame: () => Promise<void>,
  signal: AbortSignal
) {
  await seekTo(video, s0);
  video.playbackRate = 1;
  let next = 0;
  let busy = false;

  await new Promise<void>((resolve, reject) => {
    const stop = () => {
      video.pause();
      resolve();
    };
    const tick = async () => {
      if (signal.aborted) return stop();
      if (busy) return schedule();
      busy = true;
      try {
        const t = video.currentTime;
        // captura todos os instantes que o vídeo já alcançou (quadro atual é o mais próximo)
        while (next < total && (t >= targetTime(next) - 0.004 || video.ended || t >= s1)) {
          await onFrame();
          next++;
        }
      } catch (e) {
        video.pause();
        return reject(e);
      } finally {
        busy = false;
      }
      if (next >= total) return stop();
      if (video.ended || video.currentTime >= s1) {
        // o vídeo acabou antes do último instante: completa com o quadro final
        while (next < total) {
          await onFrame();
          next++;
        }
        return stop();
      }
      if (video.paused && !signal.aborted) await video.play().catch(() => {});
      schedule();
    };
    const schedule = () => {
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => tick());
      else requestAnimationFrame(() => tick());
    };
    video
      .play()
      .then(schedule)
      .catch(() => reject(new Error('O navegador não deixou tocar o vídeo para ler os quadros. Toque em “Gerar GIF” de novo.')));
  });
}
