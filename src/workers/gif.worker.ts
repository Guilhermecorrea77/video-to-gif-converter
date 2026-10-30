/// <reference lib="webworker" />
/**
 * Codificação do GIF fora da thread principal: a tela continua respondendo
 * (botão Cancelar, barra de progresso) enquanto cada quadro é quantizado.
 */
import { GIFEncoder, quantize, applyPalette, type Palette } from 'gifenc';
import type { Direction } from '../lib/settings';

export type WorkerIn =
  | { type: 'init'; width: number; height: number; colors: number }
  | { type: 'frame'; buffer: ArrayBuffer }
  | { type: 'finish'; fps: number; direction: Direction; repeat: number };

export type WorkerOut =
  | { type: 'ack'; count: number }
  | { type: 'progress'; value: number }
  | { type: 'done'; buffer: ArrayBuffer; frames: number }
  | { type: 'error'; message: string };

let width = 0;
let height = 0;
let colors = 256;
let frames: { index: Uint8Array; palette: Palette }[] = [];

const post = (msg: WorkerOut, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

/**
 * O GIF guarda o atraso em centésimos de segundo. Arredondar cada quadro
 * isoladamente acumula erro (24 fps viraria 25 fps); aqui o arredondamento
 * é feito sobre o tempo acumulado, então a duração total fica correta.
 */
function delaysFor(count: number, fps: number) {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t0 = Math.round((i * 100) / fps);
    const t1 = Math.round(((i + 1) * 100) / fps);
    out.push(Math.max(2, t1 - t0) * 10);
  }
  return out;
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      ({ width, height, colors } = msg);
      frames = [];
      return;
    }

    if (msg.type === 'frame') {
      const rgba = new Uint8ClampedArray(msg.buffer);
      const palette = quantize(rgba, colors, { format: 'rgb565' });
      const index = applyPalette(rgba, palette, 'rgb565');
      frames.push({ index, palette });
      post({ type: 'ack', count: frames.length });
      return;
    }

    if (msg.type === 'finish') {
      let order = frames.map((_, i) => i);
      if (msg.direction === 'reverso') order.reverse();
      if (msg.direction === 'vaivem' && frames.length > 2) {
        // ida e volta sem repetir o primeiro e o último quadro
        order = [...order, ...order.slice(1, -1).reverse()];
      }

      const delays = delaysFor(order.length, msg.fps);
      const gif = GIFEncoder();
      order.forEach((idx, i) => {
        const f = frames[idx];
        gif.writeFrame(f.index, width, height, {
          palette: f.palette,
          delay: delays[i],
          ...(i === 0 ? { repeat: msg.repeat } : {}),
        });
        if (i % 10 === 0) post({ type: 'progress', value: i / order.length });
      });
      gif.finish();
      const bytes = gif.bytes();
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      frames = [];
      post({ type: 'done', buffer, frames: order.length }, [buffer]);
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
