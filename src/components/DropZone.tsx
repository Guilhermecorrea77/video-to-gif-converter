import { useRef, useState } from 'react';
import { Film, ShieldCheck } from 'lucide-react';
import { cx } from './ui';
import { ACCEPT } from '../lib/source';

/** Tela inicial: escolher, arrastar ou colar um vídeo. */
export function DropZone({ onFile, error }: { onFile: (f: File) => void; error?: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <section aria-labelledby="dz-title" className="max-w-3xl">
      <h1 id="dz-title" className="font-display font-bold text-ink text-[2rem] sm:text-[2.75rem] leading-[1.05] tracking-tight">
        Transforme vídeo, GIF ou foto em figurinha
      </h1>
      <p className="mt-3 text-muted text-base sm:text-lg max-w-[60ch]">
        Figurinha animada ou parada para o WhatsApp, pronta no tamanho certo. Também salva em GIF. Tudo acontece no seu
        navegador: o arquivo não sai do seu aparelho.
      </p>

      <div
        role="button"
        tabIndex={0}
        aria-describedby="dz-help"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), inputRef.current?.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={cx('filmstrip mt-8 cursor-pointer', over && 'is-over')}
      >
        <div className="filmstrip-inner flex flex-col items-center text-center px-6 py-12 sm:py-16">
          <Film className="w-10 h-10 text-highlight" aria-hidden />
          <p className="mt-4 font-display font-semibold text-white text-xl">
            {over ? 'Solte o arquivo aqui' : 'Escolher arquivo'}
          </p>
          <p id="dz-help" className="mt-1.5 text-sm text-white/70 max-w-[42ch]">
            Vídeo (MP4, MOV, WebM), GIF, WebP, PNG ou JPG. Arraste para cá, toque para escolher ou cole com Ctrl+V.
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />

      {error && (
        <p role="alert" className="mt-4 px-4 py-3 rounded-lg bg-danger/10 text-danger text-sm font-semibold">
          {error}
        </p>
      )}

      <p className="mt-6 flex items-center gap-2 text-sm text-muted">
        <ShieldCheck className="w-4 h-4 text-ok shrink-0" aria-hidden />
        Funciona sem internet depois de aberto e sem limite de uso.
      </p>
    </section>
  );
}
