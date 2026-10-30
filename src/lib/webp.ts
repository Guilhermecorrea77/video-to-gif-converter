/**
 * Monta um WebP animado a partir de quadros WebP estáticos gerados pelo próprio
 * navegador (canvas.toBlob('image/webp')). Formato: RIFF/WEBP com VP8X + ANIM + ANMF.
 * Especificação: https://developers.google.com/speed/webp/docs/riff_container
 */

/** O navegador sabe gerar WebP? (o Safari, por exemplo, devolve PNG no lugar) */
export function canEncodeWebP(): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

export function canvasToWebP(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b && b.type === 'image/webp' ? resolve(b) : reject(new Error('Este navegador não gera imagens WebP.'))), 'image/webp', quality)
  );
}

interface Chunk {
  fourcc: string;
  data: Uint8Array;
}

const ascii = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u32 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

/** Lê os blocos de um WebP estático e devolve só o que forma a imagem (ALPH + VP8 ou VP8L). */
function imageChunks(bytes: Uint8Array): Chunk[] {
  if (ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WEBP') throw new Error('Quadro WebP inválido.');
  const out: Chunk[] = [];
  let o = 12;
  while (o + 8 <= bytes.length) {
    const fourcc = ascii(bytes, o);
    const size = u32(bytes, o + 4) >>> 0;
    if (fourcc === 'ALPH' || fourcc === 'VP8 ' || fourcc === 'VP8L') {
      out.push({ fourcc, data: bytes.subarray(o + 8, o + 8 + size) });
    }
    o += 8 + size + (size & 1);
  }
  if (!out.some((c) => c.fourcc !== 'ALPH')) throw new Error('Quadro WebP sem imagem.');
  return out;
}

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  bytes(n: number[]) {
    this.push(Uint8Array.from(n));
  }
  u24(v: number) {
    this.bytes([v & 255, (v >> 8) & 255, (v >> 16) & 255]);
  }
  chunk(fourcc: string, payload: Uint8Array) {
    const head = new Uint8Array(8);
    for (let i = 0; i < 4; i++) head[i] = fourcc.charCodeAt(i);
    new DataView(head.buffer).setUint32(4, payload.length, true);
    this.push(head);
    this.push(payload);
    if (payload.length & 1) this.bytes([0]);
  }
  concat() {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

/**
 * @param frames quadros WebP (todos do mesmo tamanho, já na ordem final)
 * @param durations duração de cada quadro em ms
 * @param loop 0 = repete sempre
 */
export async function buildAnimatedWebP(frames: Blob[], durations: number[], width: number, height: number, hasAlpha: boolean, loop = 0): Promise<Blob> {
  const cache = new Map<Blob, Chunk[]>();
  const body = new Writer();

  // VP8X: animação (+ transparência, se houver)
  const vp8x = new Writer();
  vp8x.bytes([(hasAlpha ? 0x10 : 0) | 0x02, 0, 0, 0]);
  vp8x.u24(width - 1);
  vp8x.u24(height - 1);
  body.chunk('VP8X', vp8x.concat());

  // ANIM: fundo transparente, número de repetições
  const anim = new Writer();
  anim.bytes([0, 0, 0, 0, loop & 255, (loop >> 8) & 255]);
  body.chunk('ANIM', anim.concat());

  for (let i = 0; i < frames.length; i++) {
    let chunks = cache.get(frames[i]);
    if (!chunks) {
      chunks = imageChunks(new Uint8Array(await frames[i].arrayBuffer()));
      cache.set(frames[i], chunks); // "vai e volta" reaproveita os mesmos quadros
    }
    const f = new Writer();
    f.u24(0); // x / 2
    f.u24(0); // y / 2
    f.u24(width - 1);
    f.u24(height - 1);
    f.u24(Math.max(8, Math.round(durations[i]))); // o WhatsApp exige pelo menos 8 ms
    f.bytes([0x02]); // não mistura com o quadro anterior: cada quadro substitui o outro inteiro
    for (const c of chunks) f.chunk(c.fourcc, c.data);
    body.chunk('ANMF', f.concat());
  }

  const content = body.concat();
  const header = new Uint8Array(12);
  header.set([82, 73, 70, 70]); // RIFF
  new DataView(header.buffer).setUint32(4, content.length + 4, true);
  header.set([87, 69, 66, 80], 8); // WEBP
  return new Blob([header, content], { type: 'image/webp' });
}
