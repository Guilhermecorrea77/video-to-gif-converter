/**
 * Salvar arquivo em qualquer lugar onde o app roda.
 * - Dentro do Claude (artifact): a página fica num frame que bloqueia downloads diretos;
 *   usa a capacidade "downloads", que mostra uma confirmação para a pessoa.
 * - No navegador comum (GitHub Pages, localhost): link de download normal.
 */
type DownloadsApi = { save(req: { filename: string; data: Blob }): Promise<{ status: string }> };
type ClaudeHost = { use(name: string): Promise<unknown> };

let downloadsPromise: Promise<DownloadsApi | null> | null = null;

export const insideClaude = () => typeof window !== 'undefined' && typeof (window as unknown as { claude?: ClaudeHost }).claude?.use === 'function';

function claudeDownloads(): Promise<DownloadsApi | null> {
  if (!insideClaude()) return Promise.resolve(null);
  downloadsPromise ??= (window as unknown as { claude: ClaudeHost }).claude
    .use('downloads')
    .then((d) => (d as DownloadsApi) ?? null)
    .catch(() => null);
  return downloadsPromise;
}

/** Já descobre cedo se a capacidade existe (a resposta chega de forma assíncrona). */
export function warmUpSaving() {
  void claudeDownloads();
}

export type SaveOutcome = 'saved' | 'declined' | 'unavailable';

export async function saveFile(blob: Blob, filename: string): Promise<SaveOutcome> {
  const downloads = await claudeDownloads();
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string })?.code;
      return code === 'declined' || code === 'rate_limited' ? 'declined' : 'unavailable';
    }
  }
  if (insideClaude()) return 'unavailable';

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
