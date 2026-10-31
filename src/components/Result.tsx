import { useState } from 'react';
import { Check, Download, PencilLine, Share2, Trash2 } from 'lucide-react';
import { formatBytes } from '../lib/format';
import { STICKER } from '../lib/settings';
import { insideClaude, saveFile, type SaveOutcome } from '../lib/save';

export interface GifItem {
  id: string;
  url: string;
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  frames: number;
  seconds: number;
  createdAt: number;
  kind: 'gif' | 'sticker';
  /** false = figurinha/GIF de imagem parada */
  animated?: boolean;
  /** figurinha que, mesmo no mínimo de qualidade, passou de 500 KB */
  overLimit?: boolean;
}

const HEAVY = 8 * 1024 * 1024;
const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

function canShareFiles(blob: Blob, name: string) {
  if (insideClaude()) return false; // o frame do Claude bloqueia o compartilhamento
  try {
    const file = new File([blob], name, { type: blob.type });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** O GIF pronto, com baixar e compartilhar (no celular abre a lista de apps, como o WhatsApp). */
export function Result({ item, onEdit }: { item: GifItem; onEdit: () => void }) {
  const [shared, setShared] = useState(false);
  const shareable = canShareFiles(item.blob, item.fileName);
  const [saveState, setSaveState] = useState<SaveOutcome | 'saving' | null>(null);
  const save = async () => {
    setSaveState('saving');
    setSaveState(await saveFile(item.blob, item.fileName));
  };
  const sticker = item.kind === 'sticker';

  const share = async () => {
    try {
      await navigator.share({ files: [new File([item.blob], item.fileName, { type: item.blob.type })], title: item.fileName });
      setShared(true);
    } catch {
      /* a pessoa fechou a janela de compartilhar */
    }
  };

  return (
    <section aria-labelledby="result-title" className="space-y-4">
      <div className="stage rounded-2xl p-3 sm:p-4 grid place-items-center">
        <img src={item.url} alt={`${sticker ? 'Figurinha gerada' : 'GIF gerado'}: ${item.fileName}`} className={`checker block max-w-full max-h-[52vh] w-auto h-auto ${sticker ? 'rounded-xl' : 'rounded-md'}`} />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="result-title" className="font-display font-bold text-xl text-ink">{sticker ? 'Sua figurinha está pronta' : 'Seu GIF está pronto'}</h2>
          <dl className="mt-1 grid grid-cols-2 sm:flex sm:flex-wrap gap-x-5 gap-y-1 text-sm">
            <Stat label="Tamanho" value={formatBytes(item.blob.size)} />
            <Stat label="Dimensões" value={`${item.width} × ${item.height}`} />
            <Stat label="Quadros" value={String(item.frames)} />
            {item.animated !== false && <Stat label="Duração" value={`${item.seconds.toFixed(1).replace('.', ',')} s`} />}
          </dl>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={saveState === 'saving'} className="btn btn-primary">
            {saveState === 'saved' ? <Check className="w-4 h-4" aria-hidden /> : <Download className="w-4 h-4" aria-hidden />}{' '}
            {sticker ? 'Baixar figurinha' : 'Baixar GIF'}
          </button>
          {shareable && (
            <button type="button" onClick={share} className="btn btn-secondary">
              {shared ? <Check className="w-4 h-4" aria-hidden /> : <Share2 className="w-4 h-4" aria-hidden />} Compartilhar
            </button>
          )}
          <button type="button" onClick={onEdit} className="btn btn-ghost">
            <PencilLine className="w-4 h-4" aria-hidden /> Ajustar e gerar de novo
          </button>
        </div>
      </div>

      {saveState === 'unavailable' && (
        <p role="alert" className="text-sm px-4 py-3 rounded-lg bg-danger/10 text-danger">
          Este lugar não permite baixar arquivos. Para salvar, abra o conversor no navegador: guilhermecorrea77.github.io/video-to-gif-converter
        </p>
      )}

      {sticker && (
        <div className={`text-sm px-4 py-3 rounded-lg border ${item.overLimit ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-white border-line text-muted'}`}>
          {item.overLimit ? (
            <p>
              <strong>Passou de {(item.animated === false ? STICKER.maxStaticBytes : STICKER.maxBytes) / 1024} KB</strong> mesmo na menor
              qualidade, e o WhatsApp recusa figurinhas maiores.{' '}
              {item.animated === false ? 'Tente outra imagem ou tire a legenda e os efeitos.' : 'Encurte o trecho, use menos quadros por segundo ou tire a legenda e os efeitos.'}
            </p>
          ) : (
            <>
              <p>
                <strong className="text-ink">Como usar no WhatsApp:</strong>{' '}
                {item.animated === false
                  ? 'importe este arquivo num app de pacotes de figurinhas (como o Sticker.ly) ou use a foto original no criador de figurinhas do próprio WhatsApp.'
                  : 'o criador de figurinhas do próprio WhatsApp só faz figurinhas paradas. Para a animada, importe este arquivo num app de pacotes de figurinhas (como o Sticker.ly) e adicione o pacote ao WhatsApp pelo botão + da bandeja de figurinhas.'}
              </p>
              <p className="mt-1.5">Se o app escolhido não aceitar WebP, gere a versão GIF e use-a no lugar.</p>
            </>
          )}
        </div>
      )}

      {!sticker && isTouch && (
        <p className="text-sm px-4 py-3 rounded-lg bg-white border border-line text-muted">
          <strong className="text-ink">GIF parado no celular?</strong> O arquivo é animado, mas algumas galerias mostram só a
          primeira imagem até você abrir o GIF, e alguns apps de mensagem o enviam como foto. No WhatsApp, anexe pelo
          botão <strong className="text-ink">Documento</strong> para o arquivo chegar intacto.
        </p>
      )}

      {!sticker && item.blob.size > HEAVY && (
        <p className="text-sm px-4 py-3 rounded-lg bg-highlight/25 text-ink">
          Arquivo grande ({formatBytes(item.blob.size)}). Para deixar mais leve, diminua a largura, os quadros por segundo ou as cores — ou use o ponto de partida “WhatsApp”.
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

/** GIFs gerados nesta sessão — some ao fechar a aba (nada é enviado para servidores). */
export function History({ items, currentId, onOpen, onRemove }: { items: GifItem[]; currentId?: string; onOpen: (id: string) => void; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="history-title" className="mt-10">
      <h2 id="history-title" className="font-display font-semibold text-lg text-ink">Gerados nesta sessão</h2>
      <p className="text-sm text-muted">Ficam aqui até você fechar a aba.</p>
      <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {items.map((it) => (
          <li key={it.id} className={`rounded-xl bg-white border overflow-hidden ${it.id === currentId ? 'border-accent ring-1 ring-accent' : 'border-line'}`}>
            <button type="button" onClick={() => onOpen(it.id)} className="block w-full aspect-video checker" aria-label={`Abrir ${it.fileName}`}>
              <img src={it.url} alt="" className="w-full h-full object-contain" />
            </button>
            <div className="flex items-center gap-1 px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-ink truncate" title={it.fileName}>{it.fileName}</p>
                <p className="text-xs text-muted tabular-nums">{formatBytes(it.blob.size)}</p>
              </div>
              <button type="button" onClick={() => saveFile(it.blob, it.fileName)} className="icon-btn" aria-label={`Baixar ${it.fileName}`}>
                <Download className="w-4 h-4" aria-hidden />
              </button>
              <button type="button" onClick={() => onRemove(it.id)} className="icon-btn hover:text-danger" aria-label={`Remover ${it.fileName}`}>
                <Trash2 className="w-4 h-4" aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
