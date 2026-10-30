import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Grupo recolhível do painel de ajustes. */
export function Section({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-b border-line last:border-b-0" open={defaultOpen}>
      <summary className="flex items-center justify-between gap-3 py-3.5 px-5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-paper/60">
        <span className="min-w-0">
          <span className="block font-display font-semibold text-[0.95rem] text-ink">{title}</span>
          {summary && <span className="block text-xs text-muted truncate mt-0.5">{summary}</span>}
        </span>
        <ChevronDown className="w-4 h-4 text-muted shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-5 pb-5 pt-1 space-y-4">{children}</div>
    </details>
  );
}

/** Botões de escolha única (rádio visual). */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  columns,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  columns?: number;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-labelledby={id}>
      <div id={id} className="text-sm font-semibold text-ink mb-2">{label}</div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={active}
              title={o.title}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={cx(
                'h-9 px-2 rounded-lg text-sm font-semibold border transition-colors truncate',
                active ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:border-muted',
                disabled && 'opacity-50 pointer-events-none'
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Controle deslizante com o valor visível ao lado do rótulo. */
export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  format = (v: number) => String(v),
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
        <output htmlFor={id} className="text-sm tabular-nums text-muted">{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range w-full"
      />
    </div>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted leading-relaxed">{children}</p>;
}
