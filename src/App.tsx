import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, FolderOpen, Loader2, Sparkles } from 'lucide-react';
import { DropZone } from './components/DropZone';
import { Editor } from './components/Editor';
import { SettingsPanel } from './components/SettingsPanel';
import { History, Result, type GifItem } from './components/Result';
import { CancelledError, convertVideoToGif, convertVideoToSticker, createHiddenVideo, waitForMetadata } from './lib/convert';
import { baseName, formatBytes, formatTime, isVideoFile } from './lib/format';
import { LIMITS, STICKER, effectiveFps, frameCount, loadSettings, saveSettings, type GifSettings } from './lib/settings';

interface Source {
  file: File;
  url: string;
  duration: number;
  width: number;
  height: number;
}

/** Trecho inicial sugerido: GIFs costumam ter poucos segundos */
const DEFAULT_SEGMENT = 6;

export default function App() {
  const [source, setSource] = useState<Source | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [settings, setSettings] = useState<GifSettings>(loadSettings);
  const [view, setView] = useState<'edit' | 'result'>('edit');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'lendo' | 'montando'>('lendo');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<GifItem[]>([]);
  const [currentId, setCurrentId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => saveSettings(settings), [settings]);

  // Libera a memória dos vídeos e GIFs ao sair
  const historyRef = useRef(history);
  historyRef.current = history;
  useEffect(() => () => historyRef.current.forEach((h) => URL.revokeObjectURL(h.url)), []);
  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source.url);
  }, [source]);

  const openFile = useCallback(async (file: File) => {
    if (!isVideoFile(file)) {
      setError(`“${file.name}” não parece ser um vídeo. Escolha um arquivo MP4, MOV ou WebM.`);
      return;
    }
    abortRef.current?.abort();
    setError(null);
    setLoadingFile(true);
    const url = URL.createObjectURL(file);
    const probe = createHiddenVideo(url);
    try {
      await waitForMetadata(probe);
      const duration = probe.duration;
      if (!isFinite(duration) || duration <= 0) throw new Error('Não foi possível ler a duração deste vídeo. Tente outro arquivo.');
      setSource({ file, url, duration, width: probe.videoWidth, height: probe.videoHeight });
      setStart(0);
      setEnd(Math.min(duration, DEFAULT_SEGMENT));
      setView('edit');
    } catch (e) {
      URL.revokeObjectURL(url);
      setError(e instanceof Error ? e.message : 'Não foi possível abrir este vídeo.');
    } finally {
      probe.remove();
      setLoadingFile(false);
    }
  }, []);

  // Colar (Ctrl+V) ou soltar um vídeo em qualquer lugar da página
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files || []).find(isVideoFile);
      if (f && !busy) openFile(f);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f && !busy) openFile(f);
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [busy, openFile]);

  const updateSettings = (patch: Partial<GifSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    if (view === 'result') setView('edit');
  };

  const onTrim = useCallback((s: number, e: number) => {
    setStart(Math.max(0, s));
    setEnd(e);
    setView('edit');
  }, []);

  const segment = Math.max(0, end - start);
  const frames = frameCount(segment, settings);
  const sourceFrames = frameCount(segment, { ...settings, direction: 'normal' });
  const isSticker = settings.output === 'sticker';
  const outSeconds = frames / effectiveFps(settings);
  const stickerTooLong = isSticker && outSeconds > STICKER.maxSeconds + 0.01;
  const tooLong = sourceFrames > LIMITS.maxFrames || stickerTooLong;

  const convert = async () => {
    if (!source || busy || tooLong) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    setProgress(0);
    setPhase('lendo');
    // No celular o botão fica no rodapé: rola até a prévia para mostrar o progresso
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => {
        const top = (document.getElementById('editor')?.getBoundingClientRect().top ?? 0) + window.scrollY - 72;
        window.scrollTo({ top, behavior: 'smooth' });
      });
    }
    try {
      const onP = (p: { value: number; phase: 'lendo' | 'montando' }) => {
        setProgress(p.value);
        setPhase(p.phase);
      };
      const r = isSticker
        ? await convertVideoToSticker(source.file, start, end, settings, onP, ac.signal)
        : await convertVideoToGif(source.file, start, end, settings, onP, ac.signal);

      const base = baseName(source.file.name) + (isSticker ? '-figurinha' : '');
      const ext = isSticker ? 'webp' : 'gif';
      const taken = new Set(history.map((h) => h.fileName));
      let fileName = `${base}.${ext}`;
      for (let n = 2; taken.has(fileName); n++) fileName = `${base}-${n}.${ext}`;

      const item: GifItem = {
        id: crypto.randomUUID?.() ?? String(Date.now()),
        url: URL.createObjectURL(r.blob),
        blob: r.blob,
        fileName,
        width: r.width,
        height: r.height,
        frames: r.frames,
        seconds: r.seconds,
        createdAt: Date.now(),
        kind: isSticker ? 'sticker' : 'gif',
        overLimit: 'overLimit' in r ? Boolean(r.overLimit) : false,
      };
      setHistory((h) => [item, ...h]);
      setCurrentId(item.id);
      setView('result');
    } catch (e) {
      if (!(e instanceof CancelledError)) setError(e instanceof Error ? e.message : 'A conversão falhou. Tente um trecho menor.');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const current = useMemo(() => history.find((h) => h.id === currentId), [history, currentId]);

  const removeItem = (id: string) => {
    setHistory((h) => {
      const it = h.find((x) => x.id === id);
      if (it) URL.revokeObjectURL(it.url);
      return h.filter((x) => x.id !== id);
    });
    if (id === currentId) {
      setCurrentId(undefined);
      setView('edit');
    }
  };

  const openFromHistory = (id: string) => {
    setCurrentId(id);
    if (source) setView('result');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="video/*,.mov,.mkv"
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) openFile(f);
        e.target.value = '';
      }}
    />
  );

  return (
    <div className="min-h-dvh flex flex-col">
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>

      <header className="border-b border-line bg-white/70 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button type="button" onClick={() => !busy && setSource(null)} className="flex items-center gap-2 font-display font-bold text-ink text-lg" aria-label="Vídeo para GIF — início">
            <span className="w-8 h-8 rounded-lg bg-ink grid place-items-center">
              <Film className="w-4 h-4 text-highlight" aria-hidden />
            </span>
            Vídeo para GIF
          </button>
          {source && (
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} className="btn btn-ghost btn-sm ml-auto">
              <FolderOpen className="w-4 h-4" aria-hidden /> Trocar vídeo
            </button>
          )}
          {fileInput}
        </div>
      </header>

      <main id="conteudo" className={`flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 pb-10 lg:pb-12`}>
        {!source ? (
          <>
            {loadingFile ? (
              <p role="status" className="flex items-center gap-2 text-muted">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Abrindo o vídeo…
              </p>
            ) : (
              <DropZone onFile={openFile} error={error} />
            )}
          </>
        ) : (
          <div className="grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
            <div id="editor" className="min-w-0 scroll-mt-20">
              <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h1 className="font-display font-bold text-ink text-xl sm:text-2xl truncate max-w-full" title={source.file.name}>
                  {source.file.name}
                </h1>
                <p className="text-sm text-muted tabular-nums">
                  {formatBytes(source.file.size)}, {source.width} × {source.height}, {formatTime(source.duration, false)}
                </p>
              </div>

              {error && (
                <p role="alert" className="mb-4 px-4 py-3 rounded-lg bg-danger/10 text-danger text-sm font-semibold">{error}</p>
              )}

              {view === 'result' && current ? (
                <Result item={current} onEdit={() => setView('edit')} />
              ) : (
                <Editor
                  url={source.url}
                  duration={source.duration}
                  start={start}
                  end={end}
                  onTrim={onTrim}
                  settings={settings}
                  busy={busy}
                  progress={progress}
                  progressLabel={phase === 'lendo' ? 'Lendo os quadros do vídeo…' : isSticker ? 'Montando a figurinha…' : 'Montando o GIF…'}
                  onCancel={() => abortRef.current?.abort()}
                />
              )}
            </div>

            <aside aria-label="Ajustes do GIF" className="panel lg:sticky lg:top-20 rounded-2xl bg-white border border-line overflow-hidden">
              <div className="px-5 pt-5 pb-1">
                <h2 className="font-display font-bold text-lg text-ink">Ajustes</h2>
              </div>
              <SettingsPanel settings={settings} onChange={updateSettings} disabled={busy} />

              {/* Barra de ação: fixa no rodapé no celular, dentro do painel no computador */}
              <div className="fixed lg:static inset-x-0 bottom-0 z-30 bg-white border-t border-line px-4 sm:px-5 py-3 flex items-center gap-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
                <div className="min-w-0 flex-1 text-sm leading-tight">
                  <p className={tooLong ? 'text-danger font-semibold' : 'text-ink font-semibold tabular-nums'}>
                    {stickerTooLong ? `Figurinha longa demais (${outSeconds.toFixed(1).replace('.', ',')} s)` : tooLong ? `Trecho longo demais (${sourceFrames} quadros)` : `${frames} quadros`}
                  </p>
                  <p className="text-muted tabular-nums">
                    {stickerTooLong ? `Máximo ${STICKER.maxSeconds} s: encurte o trecho ou acelere` : tooLong ? `Máximo ${LIMITS.maxFrames}: encurte o trecho ou reduza os quadros/s` : `${outSeconds.toFixed(1).replace('.', ',')} s de ${isSticker ? 'figurinha' : 'GIF'}`}
                  </p>
                </div>
                <button type="button" onClick={convert} disabled={busy || tooLong} className="btn btn-primary btn-lg shrink-0">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Sparkles className="w-4 h-4" aria-hidden />}
                  {busy ? 'Gerando…' : view === 'result' ? 'Gerar de novo' : isSticker ? 'Gerar figurinha' : 'Gerar GIF'}
                </button>
              </div>
            </aside>
          </div>
        )}

        <History items={history} currentId={view === 'result' ? currentId : undefined} onOpen={openFromHistory} onRemove={removeItem} />
      </main>

      <footer className={`border-t border-line text-sm text-muted ${source ? 'pb-24 lg:pb-0' : ''}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row gap-2 justify-between">
          <p>Tudo é processado no seu aparelho. Nenhum vídeo é enviado para a internet.</p>
          <a className="underline hover:text-ink" href="https://github.com/Guilhermecorrea77/video-to-gif-converter" target="_blank" rel="noreferrer">
            Código no GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
