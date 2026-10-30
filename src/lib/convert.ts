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

    // A velocidade muda o intervalo entre as amostras do vídeo, não o atraso do GIF
    // (navegadores travam atrasos menores que 20 ms em 100 ms).
    const step = settings.speed / settings.fps;
    const MAX_IN_FLIGHT = 3;
    const targetTime = (i: number) => Math.min(s1 - 0.001, s0 + i * step);
    let sent = 0;

    const waitAcks = async (upTo: number) => {
      while (acked < upTo && !state.failure && !signal.aborted) {
        await new Promise<void>((r) => (ackWaiter = r));
        ackWaiter = null;
      }
      if (signal.aborted) throw new CancelledError();
      if (state.failure) throw state.failure;
    };

    const capture = () => {
      renderFrame(ctx, video, layout, settings);
      const { data } = ctx.getImageData(0, 0, layout.width, layout.height);
      const sig = frameSignature(data);
      send({ type: 'frame', buffer: data.buffer }, [data.buffer]);
      sent++;
      return sig;
    };

    const restart = async () => {
      await waitAcks(sent);
      send({ type: 'init', width: layout.width, height: layout.height, colors: settings.colors });
      acked = 0;
      sent = 0;
    };

    await primeVideo(video);
    send({ type: 'init', width: layout.width, height: layout.height, colors: settings.colors });

    // ---- Modo 1: buscar cada instante (preciso e rápido no computador) ----
    // Primeiro sem espera extra; se os primeiros quadros saírem iguais, tenta de novo
    // esperando o navegador apresentar cada imagem; se ainda assim falhar, vai para o modo 2.
    const PROBE = Math.min(6, total);
    let seekingWorks = true;

    for (const waitFrame of [false, true]) {
      const probeSigs = new Set<number>();
      let repeated = false;
      for (let i = 0; i < total; i++) {
        if (signal.aborted) throw new CancelledError();
        if (state.failure) throw state.failure;

        await seekTo(video, targetTime(i), waitFrame);
        const sig = capture();
        if (i < PROBE) probeSigs.add(sig);
        if (i === PROBE - 1 && PROBE >= 4 && probeSigs.size === 1) {
          repeated = true;
          break;
        }
        await waitAcks(sent - MAX_IN_FLIGHT);
        onProgress({ phase: 'lendo', value: ((i + 1) / total) * 0.9 });
      }
      if (!repeated) break;
      await restart();
      if (waitFrame) seekingWorks = false;
    }

    // ---- Modo 2: tocar o vídeo e capturar os quadros enquanto ele passa ----
    if (!seekingWorks) {
      console.info('[gif] a busca de quadros não trouxe imagens novas; capturando durante a reprodução');
      onProgress({ phase: 'lendo', value: 0 });
      await capturePlaying(video as FrameVideo, s0, s1, total, targetTime, async () => {
        capture();
        onProgress({ phase: 'lendo', value: (sent / total) * 0.9 });
        if (sent - acked > MAX_IN_FLIGHT) {
          video.pause();
          await waitAcks(sent - MAX_IN_FLIGHT);
          await video.play().catch(() => {});
        }
      }, signal);
      if (signal.aborted) throw new CancelledError();
    }

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
    cleanup();
  }
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
