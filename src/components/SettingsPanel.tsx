import { RotateCcw } from 'lucide-react';
import { DEFAULT_SETTINGS, PRESETS, STICKER, type GifSettings } from '../lib/settings';
import { canEncodeWebP } from '../lib/webp';
import { Hint, RangeField, Section, Segmented, cx } from './ui';

const webpSupported = typeof document !== 'undefined' && canEncodeWebP();

interface Props {
  settings: GifSettings;
  onChange: (patch: Partial<GifSettings>) => void;
  disabled: boolean;
}

const FILTERS: { value: GifSettings['filter']; label: string }[] = [
  { value: 'nenhum', label: 'Nenhum' },
  { value: 'pb', label: 'P&B' },
  { value: 'sepia', label: 'Sépia' },
  { value: 'vibrante', label: 'Vibrante' },
  { value: 'retro', label: 'Retrô' },
  { value: 'negativo', label: 'Negativo' },
];

const REPEATS: { value: number; label: string; title: string }[] = [
  { value: 0, label: 'Sempre', title: 'Repete sem parar' },
  { value: -1, label: '1 vez', title: 'Toca uma vez e para' },
  { value: 2, label: '3 vezes', title: 'Toca 3 vezes e para' },
];

const TEXT_COLORS = ['#ffffff', '#ffd43b', '#111111', '#ff4d6d', '#4dabf7'];

export function SettingsPanel({ settings: s, onChange, disabled }: Props) {
  const activePreset = PRESETS.find((p) => Object.entries(p.values).every(([k, v]) => s[k as keyof GifSettings] === v));
  const effects = [s.filter !== 'nenhum' && FILTERS.find((f) => f.value === s.filter)?.label, s.brightness !== 0 && 'brilho', s.contrast !== 0 && 'contraste'].filter(Boolean);

  const sticker = s.output === 'sticker';

  return (
    <div className="divide-y divide-line">
      <div className="px-5 py-4 space-y-3">
        <Segmented
          label="Salvar como"
          value={s.output}
          disabled={disabled}
          onChange={(v) => onChange({ output: v })}
          options={[
            { value: 'gif', label: 'GIF' },
            { value: 'sticker', label: 'Figurinha', title: 'Figurinha animada do WhatsApp (WebP 512×512)' },
          ]}
        />
        {sticker && (
          <>
            {!webpSupported && (
              <p role="alert" className="text-sm px-3 py-2 rounded-lg bg-danger/10 text-danger">
                Este navegador não gera figurinhas (WebP). No iPhone, salve como GIF; no computador ou Android, use Chrome, Edge ou Firefox.
              </p>
            )}
            <Segmented
              label="Encaixe no quadrado"
              value={s.stickerFit}
              disabled={disabled}
              onChange={(v) => onChange({ stickerFit: v })}
              options={[
                { value: 'cover', label: 'Cortar', title: 'Preenche o quadrado cortando as bordas' },
                { value: 'contain', label: 'Inteiro', title: 'Mostra o vídeo inteiro com sobras transparentes' },
              ]}
            />
            <Hint>
              Figurinha animada do WhatsApp: {STICKER.size}×{STICKER.size} px, até {STICKER.maxSeconds} s e {STICKER.maxBytes / 1024} KB. A
              qualidade é ajustada sozinha para caber.
            </Hint>
          </>
        )}
      </div>

      {!sticker && (
      <div className="px-5 py-4">
        <div className="text-sm font-semibold text-ink mb-2">Ponto de partida</div>
        <div className="grid gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(p.values)}
              aria-pressed={activePreset?.id === p.id}
              title={p.hint}
              className={cx(
                'rounded-lg border px-3 py-2 text-left transition-colors flex items-baseline justify-between gap-3',
                activePreset?.id === p.id ? 'border-accent bg-accent/8 ring-1 ring-accent' : 'border-line bg-white hover:border-muted',
                disabled && 'opacity-50 pointer-events-none'
              )}
            >
              <span className="text-sm font-semibold text-ink whitespace-nowrap">{p.label}</span>
              <span className="text-xs text-muted text-right">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>
      )}

      {sticker ? (
        <Section title="Fluidez" summary={`${Math.min(s.fps, STICKER.maxFps)} quadros/s`} defaultOpen>
          <Segmented
            label="Quadros por segundo"
            value={Math.min(s.fps, STICKER.maxFps)}
            disabled={disabled}
            onChange={(v) => onChange({ fps: v })}
            options={[8, 10, 12, 15].map((v) => ({ value: v, label: String(v) }))}
          />
          <Hint>Menos quadros deixam a figurinha mais leve e com melhor qualidade de imagem.</Hint>
        </Section>
      ) : (
      <>
      <Section title="Tamanho e fluidez" summary={`${s.width} px de largura, ${s.fps} quadros/s, ${s.colors} cores`} defaultOpen>
        <Segmented
          label="Largura"
          value={s.width}
          disabled={disabled}
          onChange={(v) => onChange({ width: v })}
          options={[240, 320, 480, 640, 800].map((v) => ({ value: v, label: String(v) }))}
        />
        <Segmented
          label="Quadros por segundo"
          value={s.fps}
          disabled={disabled}
          onChange={(v) => onChange({ fps: v })}
          options={[8, 10, 12, 15, 20, 25].map((v) => ({ value: v, label: String(v) }))}
          columns={6}
        />
        <Segmented
          label="Cores"
          value={s.colors}
          disabled={disabled}
          onChange={(v) => onChange({ colors: v })}
          options={[32, 64, 128, 256].map((v) => ({ value: v, label: String(v) }))}
        />
        <Hint>Mais largura, quadros e cores deixam o GIF mais bonito — e mais pesado.</Hint>
      </Section>

      <Section title="Enquadramento" summary={s.aspect === 'original' ? 'Formato original' : `Corte ${s.aspect}`}>
        <Segmented
          label="Formato"
          value={s.aspect}
          disabled={disabled}
          onChange={(v) => onChange({ aspect: v })}
          options={[
            { value: 'original', label: 'Original' },
            { value: '1:1', label: '1:1', title: 'Quadrado' },
            { value: '4:5', label: '4:5', title: 'Retrato (feed)' },
            { value: '9:16', label: '9:16', title: 'Vertical (stories)' },
            { value: '16:9', label: '16:9', title: 'Paisagem' },
          ]}
        />
        <Hint>O corte é feito a partir do centro do vídeo.</Hint>
      </Section>
      </>
      )}

      <Section title="Movimento" summary={`${String(s.speed).replace('.', ',')}×, ${s.direction === 'normal' ? 'normal' : s.direction === 'reverso' ? 'de trás para frente' : 'vai e volta'}${sticker ? '' : `, ${REPEATS.find((r) => r.value === s.repeat)?.label.toLowerCase()}`}`}>
        <Segmented
          label="Velocidade"
          value={s.speed}
          disabled={disabled}
          onChange={(v) => onChange({ speed: v })}
          options={[0.5, 0.75, 1, 1.5, 2].map((v) => ({ value: v, label: `${String(v).replace('.', ',')}×` }))}
        />
        <Segmented
          label="Direção"
          value={s.direction}
          disabled={disabled}
          onChange={(v) => onChange({ direction: v })}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'reverso', label: 'Reverso', title: 'Toca de trás para frente' },
            { value: 'vaivem', label: 'Vai e volta' },
          ]}
        />
        {!sticker && <Segmented label="Repetição" value={s.repeat} disabled={disabled} onChange={(v) => onChange({ repeat: v })} options={REPEATS} />}
        <Hint>A prévia mostra a velocidade; a direção é aplicada ao gerar.{sticker ? ' Figurinhas sempre repetem.' : ''}</Hint>
      </Section>

      <Section title="Efeitos" summary={effects.length ? effects.join(', ') : 'Nenhum efeito'}>
        <Segmented label="Filtro" value={s.filter} disabled={disabled} onChange={(v) => onChange({ filter: v })} options={FILTERS} columns={3} />
        <RangeField label="Brilho" value={s.brightness} min={-50} max={50} disabled={disabled} format={(v) => (v > 0 ? `+${v}` : String(v))} onChange={(v) => onChange({ brightness: v })} />
        <RangeField label="Contraste" value={s.contrast} min={-50} max={50} disabled={disabled} format={(v) => (v > 0 ? `+${v}` : String(v))} onChange={(v) => onChange({ contrast: v })} />
      </Section>

      <Section title="Legenda" summary={s.text.trim() ? `“${s.text.trim().slice(0, 28)}${s.text.trim().length > 28 ? '…' : ''}”` : 'Sem texto'}>
        <div>
          <label htmlFor="caption" className="text-sm font-semibold text-ink mb-1.5 block">Texto</label>
          <textarea
            id="caption"
            rows={2}
            maxLength={120}
            value={s.text}
            disabled={disabled}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Ex.: Segunda-feira chegou"
            className="w-full px-3 py-2 rounded-lg border border-line bg-white text-ink resize-y"
          />
        </div>
        <Segmented
          label="Posição"
          value={s.textPosition}
          disabled={disabled}
          onChange={(v) => onChange({ textPosition: v })}
          options={[
            { value: 'top', label: 'Em cima' },
            { value: 'bottom', label: 'Embaixo' },
          ]}
        />
        <RangeField label="Tamanho" value={s.textSize} min={6} max={24} disabled={disabled} format={(v) => `${v}%`} onChange={(v) => onChange({ textSize: v })} />
        <div>
          <div className="text-sm font-semibold text-ink mb-2" id="color-label">Cor</div>
          <div className="flex gap-2" role="radiogroup" aria-labelledby="color-label">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={s.textColor === c}
                aria-label={`Cor ${c}`}
                disabled={disabled}
                onClick={() => onChange({ textColor: c })}
                className={cx('w-9 h-9 rounded-full border-2 transition-transform', s.textColor === c ? 'border-accent scale-110' : 'border-line')}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </Section>

      <div className="px-5 py-3">
        <button type="button" disabled={disabled} onClick={() => onChange({ ...DEFAULT_SETTINGS, text: s.text })} className="btn btn-ghost btn-sm -ml-2">
          <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Restaurar ajustes padrão
        </button>
      </div>
    </div>
  );
}
