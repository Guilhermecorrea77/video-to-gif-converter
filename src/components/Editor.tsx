import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, X } from 'lucide-react';
import { layoutFor, renderFrame } from '../lib/render';
import type { GifSettings } from '../lib/settings';
import { formatTime, makeThumbnails } from '../lib/format';
import { cx } from './ui';

interface Props {
  url: string;
  duration: number;
  start: number;
  end: number;
  onTrim: (start: number, end: number) => void;
  settings: GifSettings;
  busy: boolean;
  progress: number;
  progressLabel: string;
  onCancel: () => void;
}

const MIN_GAP = 0.1;
const THUMBS = 10;

/**
 * Prévia ao vivo (já com enquadramento, filtros e legenda) e linha do tempo
 * com miniaturas e alças para escolher o trecho.
 */
export function Editor({ url, duration, start, end, onTrim, settings, busy, progress, progressLabel, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(start);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const layout = useMemo(() => (dims ? layoutFor(dims.w, dims.h, settings) : null), [dims, settings.aspect, settings.width, settings.output, settings.stickerFit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Miniaturas da linha do tempo (em segundo plano)
  useEffect(() => {
    const ac = new AbortController();
    setThumbs([]);
    makeThumbnails(url, THUMBS, 56, ac.signal).then((t) => !ac.signal.aborted && setThumbs(t));
    return () => ac.abort();
  }, [url]);

  // Desenha o quadro atual na prévia
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const draw = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || !v.videoWidth || v.readyState < 2) return;
    const l = layoutFor(v.videoWidth, v.videoHeight, settingsRef.current);
    if (c.width !== l.width || c.height !== l.height) {
      c.width = l.width;
      c.height = l.height;
    }
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) renderFrame(ctx, v, l, settingsRef.current);
  }, []);

  useEffect(draw, [settings, draw]);

  // Laço de reprodução: fica dentro do trecho escolhido
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = settings.speed;
    let raf = 0;
    const tick = () => {
      if (v.currentTime >= end - 0.02 || v.currentTime < start - 0.05) v.currentTime = start;
      setTime(v.currentTime);
      draw();
      raf = requestAnimationFrame(tick);
    };
    if (playing) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, start, end, settings.speed, draw]);

  useEffect(() => {
    if (busy) {
      videoRef.current?.pause();
      setPlaying(false);
    }
  }, [busy]);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(duration, t));
    v.currentTime = clamped;
    setTime(clamped);
  }, [duration]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || busy) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end - 0.02) v.currentTime = start;
      v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      v.pause();
      setPlaying(false);
    }
  }, [busy, start, end]);

  const markIn = useCallback(() => onTrim(Math.min(time, end - MIN_GAP), end), [time, end, onTrim]);
  const markOut = useCallback(() => onTrim(start, Math.max(time, start + MIN_GAP)), [time, start, onTrim]);

  // Atalhos: espaço = tocar/pausar, I = início aqui, O = fim aqui
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (busy || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el.closest('input, textarea, select, [contenteditable], [role=slider]')) return;
      if (e.key === ' ' && !el.closest('button, summary, a')) {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === 'i') markIn();
      else if (e.key.toLowerCase() === 'o') markOut();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, togglePlay, markIn, markOut]);

  // ---------- Arrastar alças / clicar na trilha ----------
  const timeAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };

  const startDrag = (kind: 'start' | 'end' | 'seek') => (e: React.PointerEvent) => {
    if (busy) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (clientX: number) => {
      const t = timeAt(clientX);
      if (kind === 'start') {
        const ns = Math.min(t, end - MIN_GAP);
        onTrim(ns, end);
        seek(ns);
      } else if (kind === 'end') {
        const ne = Math.max(t, start + MIN_GAP);
        onTrim(start, ne);
        seek(ne);
      } else seek(t);
    };
    move(e.clientX);
    const target = e.currentTarget as HTMLElement;
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const handleKey = (kind: 'start' | 'end') => (e: React.KeyboardEvent) => {
    const delta = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0);
    if (!delta) return;
    e.preventDefault();
    if (kind === 'start') {
      const ns = Math.max(0, Math.min(start + delta, end - MIN_GAP));
      onTrim(ns, end);
      seek(ns);
    } else {
      const ne = Math.min(duration, Math.max(end + delta, start + MIN_GAP));
      onTrim(start, ne);
      seek(ne);
    }
  };

  const pct = (t: number) => `${(t / duration) * 100}%`;
  const segment = end - start;

  return (
    <div className="space-y-4">
      {/* Palco com a prévia */}
      <div className="stage relative rounded-2xl overflow-hidden grid place-items-center min-h-[220px] sm:min-h-[320px] p-3 sm:p-4">
        <video
          ref={videoRef}
          src={url}
          muted
          playsInline
          preload="auto"
          // fica fora da tela (não "display:none"): o Safari só atualiza quadros de vídeos renderizados
          className="absolute w-px h-px opacity-0 pointer-events-none"
          aria-hidden
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setDims({ w: v.videoWidth, h: v.videoHeight });
            v.currentTime = start;
          }}
          onSeeked={() => !playing && draw()}
          onLoadedData={draw}
          onPause={() => setPlaying(false)}
        />
        <canvas
          ref={canvasRef}
          className={cx('block max-w-full max-h-[52vh] w-auto h-auto shadow-[0_10px_40px_rgba(0,0,0,.45)]', settings.output === 'sticker' ? 'checker rounded-xl' : 'rounded-md')}
          aria-label="Prévia do GIF"
          role="img"
        />

        {busy && (
          <div role="status" aria-live="polite" className="absolute inset-0 bg-ink/85 backdrop-blur-[2px] grid place-items-center p-6">
            <div className="w-full max-w-xs text-center text-white">
              <p className="font-display font-semibold text-lg">{progressLabel}</p>
              <div className="mt-3 h-2 rounded-full bg-white/15 overflow-hidden" aria-hidden>
                <div className="h-full bg-highlight transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="mt-2 text-sm text-white/75 tabular-nums">{Math.round(progress * 100)}%</p>
              <button type="button" onClick={onCancel} className="btn btn-on-dark mt-4">
                <X className="w-4 h-4" aria-hidden /> Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Controles de reprodução */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={togglePlay} disabled={busy} className="btn btn-secondary w-11 px-0" aria-label={playing ? 'Pausar' : 'Tocar o trecho'}>
          {playing ? <Pause className="w-4 h-4" aria-hidden /> : <Play className="w-4 h-4" aria-hidden />}
        </button>
        <button type="button" onClick={() => seek(start)} disabled={busy} className="btn btn-secondary w-11 px-0" aria-label="Voltar ao início do trecho">
          <SkipBack className="w-4 h-4" aria-hidden />
        </button>
        <span className="text-sm tabular-nums text-muted ml-1">
          <span className="text-ink font-semibold">{formatTime(time)}</span> / {formatTime(duration)}
        </span>
        {layout && (
          <span className="ml-auto text-sm text-muted tabular-nums">
            {layout.width} × {layout.height} px
          </span>
        )}
      </div>

      {/* Linha do tempo */}
      <div>
        <div
          ref={trackRef}
          onPointerDown={startDrag('seek')}
          className={cx('timeline relative h-16 rounded-xl overflow-hidden touch-none select-none', busy ? 'opacity-60' : 'cursor-pointer')}
        >
          <div className="absolute inset-0 flex">
            {(thumbs.length ? thumbs : Array.from({ length: THUMBS }, () => '')).map((src, i) =>
              src ? (
                <img key={i} src={src} alt="" className="h-full flex-1 min-w-0 object-cover" draggable={false} />
              ) : (
                <div key={i} className="h-full flex-1 bg-ink/80 border-r border-white/5" />
              )
            )}
          </div>
          {/* fora do trecho fica escurecido */}
          <div className="absolute inset-y-0 left-0 bg-ink/70" style={{ width: pct(start) }} />
          <div className="absolute inset-y-0 right-0 bg-ink/70" style={{ left: pct(end) }} />
          {/* trecho selecionado */}
          <div className="absolute inset-y-0 border-y-[3px] border-highlight pointer-events-none" style={{ left: pct(start), width: pct(segment) }} />
          {/* agulha */}
          <div className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.4)] pointer-events-none" style={{ left: pct(time) }} />
          {(['start', 'end'] as const).map((k) => (
            <div
              key={k}
              role="slider"
              tabIndex={busy ? -1 : 0}
              aria-label={k === 'start' ? 'Início do trecho' : 'Fim do trecho'}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration * 10) / 10}
              aria-valuenow={Math.round((k === 'start' ? start : end) * 10) / 10}
              aria-valuetext={formatTime(k === 'start' ? start : end)}
              onPointerDown={startDrag(k)}
              onKeyDown={handleKey(k)}
              className={cx('handle absolute inset-y-0 w-4 bg-highlight grid place-items-center cursor-ew-resize', k === 'start' ? 'rounded-l-lg' : '-translate-x-full rounded-r-lg')}
              style={{ left: pct(k === 'start' ? start : end) }}
            >
              <span className="w-0.5 h-6 rounded bg-ink/60" aria-hidden />
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <TimeField label="Início" value={start} max={end - MIN_GAP} min={0} disabled={busy} onChange={(v) => onTrim(v, end)} />
          <TimeField label="Fim" value={end} min={start + MIN_GAP} max={duration} disabled={busy} onChange={(v) => onTrim(start, v)} />
          <span className="text-muted">
            Trecho: <strong className="text-ink tabular-nums">{segment.toFixed(1).replace('.', ',')} s</strong>
          </span>
          <span className="flex gap-1.5 sm:ml-auto">
            <button type="button" onClick={markIn} disabled={busy} className="btn btn-ghost btn-sm" title="Atalho: tecla I">
              Início aqui
            </button>
            <button type="button" onClick={markOut} disabled={busy} className="btn btn-ghost btn-sm" title="Atalho: tecla O">
              Fim aqui
            </button>
          </span>
        </div>
        <p className="hidden sm:block mt-2 text-xs text-muted">
          Arraste as alças amarelas ou use as setas do teclado nelas (Shift = 1 s). Espaço toca o trecho, I e O marcam início e fim.
        </p>
      </div>
    </div>
  );
}

function TimeField({ label, value, min, max, onChange, disabled }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={0.1}
        min={Math.max(0, min)}
        max={max}
        value={Math.round(value * 10) / 10}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        className="w-20 h-9 px-2 rounded-lg border border-line bg-white tabular-nums text-ink"
      />
      <span className="text-muted -ml-1">s</span>
    </label>
  );
}
