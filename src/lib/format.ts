import { createHiddenVideo, seekTo, waitForMetadata } from './convert';

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

/** 0:03,4 */
export function formatTime(t: number, precise = true) {
  if (!isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const sec = precise ? s.toFixed(1).padStart(4, '0').replace('.', ',') : String(Math.floor(s)).padStart(2, '0');
  return `${m}:${sec}`;
}

/** "ferias.praia.mp4" → "ferias.praia" (o original cortava no primeiro ponto) */
export const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || 'video';

export const isVideoFile = (f: File) =>
  f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|ogv|3gp)$/i.test(f.name);

/** Gera miniaturas espaçadas ao longo do vídeo para a linha do tempo. */
export async function makeThumbnails(url: string, count: number, height = 56, signal?: AbortSignal): Promise<string[]> {
  const video = createHiddenVideo(url);
  try {
    await waitForMetadata(video);
    const ratio = video.videoWidth / video.videoHeight || 16 / 9;
    const canvas = document.createElement('canvas');
    canvas.height = height * 2; // nítido em telas retina
    canvas.width = Math.round(canvas.height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    const thumbs: string[] = [];
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) break;
      await seekTo(video, ((i + 0.5) / count) * video.duration);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      thumbs.push(canvas.toDataURL('image/jpeg', 0.7));
    }
    return thumbs;
  } catch {
    return [];
  } finally {
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}
