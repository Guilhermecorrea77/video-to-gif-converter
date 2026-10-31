declare module 'omggif' {
  export interface GifFrameInfo {
    x: number;
    y: number;
    width: number;
    height: number;
    /** centésimos de segundo */
    delay: number;
    /** 0/1 = mantém, 2 = limpa a área, 3 = volta ao quadro anterior */
    disposal: number;
    transparent_index: number | null;
    interlaced: boolean;
  }
  export class GifReader {
    constructor(buf: Uint8Array);
    width: number;
    height: number;
    numFrames(): number;
    loopCount(): number;
    frameInfo(i: number): GifFrameInfo;
    decodeAndBlitFrameRGBA(i: number, pixels: Uint8Array | Uint8ClampedArray): void;
  }
}
