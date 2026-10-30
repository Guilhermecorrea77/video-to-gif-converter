import { computeLayout, renderFrame } from './render';
import { LIMITS, frameCount, type GifSettings } from './settings';
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

/** Cria um <video> preso ao DOM (WebViews como a do WhatsApp e o Safari do iPhone exigem isso para buscar quadros). */
export function createHiddenVideo(url: string) {
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  Object.assign(video.style, { position: 'fixed', left: '-9999px', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(video);
  return video;
}

export function waitForMetadata(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    if (video.readyState >= 1) return resolve();
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Não foi possível abrir este vídeo. Tente um MP4 (H.264) ou WebM.')), { once: true });
  });
}

/** Busca um instante exato e espera o quadro ficar pronto para desenhar. */
export function seekTo(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', finish);
      resolve();
    };
    // Algumas WebViews nunca disparam "seeked": segue depois de 1,5 s
    const timer = setTimeout(finish, 1500);
    video.addEventListener('seeked', finish);
    video.currentTime = time;
  });
}

export async function convertVideoToGif(
  file: File,
  start: number,
  end: number,
  settings: GifSettings,
  onProgress: (p: ConvertProgress) => void,
  signal: AbortSignal
): Promise<ConvertResult> {
  const url = URL.createObjectURL(file);
  const video = createHiddenVideo(url);
  const worker = new Worker(new URL('../workers/gif.worker.ts', import.meta.url), { type: 'module' });

  const cleanup = () => {
    worker.terminate();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  };

  try {
    await waitForMetadata(video);
    const s0 = Math.max(0, start);
    const s1 = Math.min(video.duration, end);
    const seconds = s1 - s0;
    if (!(seconds > 0)) throw new Error('Escolha um trecho com pelo menos 0,1 s.');

    const total = frameCount(seconds, { ...settings, direction: 'normal' });
    if (total > LIMITS.maxFrames) {
      throw new Error(
        `Esse trecho geraria ${total} quadros (o limite é ${LIMITS.maxFrames}). Encurte o trecho, reduza os quadros por segundo ou aumente a velocidade.`
      );
    }

    const layout = computeLayout(video.videoWidth, video.videoHeight, settings);
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Seu navegador não permitiu desenhar os quadros (canvas indisponível).');

    // Mensagens do worker viram promessas simples
    let acked = 0;
    let ackWaiter: (() => void) | null = null;
    let finishResolve: ((r: { buffer: ArrayBuffer; frames: number }) => void) | null = null;
    const state: { failure: Error | null } = { failure: null };
    let failReject: ((e: Error) => void) | null = null;

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
    // Se a pessoa cancelar enquanto esperamos o worker, destrava a espera
    signal.addEventListener('abort', () => ackWaiter?.(), { once: true });

    send({ type: 'init', width: layout.width, height: layout.height, colors: settings.colors });

    // A velocidade muda o intervalo entre as amostras do vídeo, não o atraso do GIF
    // (navegadores travam atrasos menores que 20 ms em 100 ms).
    const step = settings.speed / settings.fps;
    const MAX_IN_FLIGHT = 3;

    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new CancelledError();
      if (state.failure) throw state.failure;

      await seekTo(video, Math.min(s1 - 0.001, s0 + i * step));
      renderFrame(ctx, video, layout, settings);
      const { data } = ctx.getImageData(0, 0, layout.width, layout.height);
      send({ type: 'frame', buffer: data.buffer }, [data.buffer]);

      // Não deixa a fila do worker crescer demais (memória do celular)
      while (i + 1 - acked > MAX_IN_FLIGHT && !state.failure && !signal.aborted) {
        await new Promise<void>((r) => (ackWaiter = r));
        ackWaiter = null;
      }
      onProgress({ phase: 'lendo', value: ((i + 1) / total) * 0.9 });
    }

    while (acked < total && !state.failure && !signal.aborted) {
      await new Promise<void>((r) => (ackWaiter = r));
      ackWaiter = null;
    }
    if (signal.aborted) throw new CancelledError();
    if (state.failure) throw state.failure;

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
    cleanup();
  }
}
