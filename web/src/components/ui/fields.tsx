import { useId, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import f from './search.module.css';
import s from './ui.module.css';

export { Select, type SelectOption } from './Select';

export function Chip({ pressed, onClick, children, style }: { pressed: boolean; onClick: () => void; children: ReactNode; style?: CSSProperties }) {
  return (
    <button type="button" className={s.chip} aria-pressed={pressed} onClick={onClick} style={style}>
      {children}
    </button>
  );
}

export function RarityChip({ pressed, color, onClick, children }: { pressed: boolean; color: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`${s.chip} ${s.rarityChip}`} aria-pressed={pressed} onClick={onClick}>
      <span aria-hidden="true" className={s.square} style={{ background: color }} />
      {children}
    </button>
  );
}

export const SearchIcon = ({ className }: { className?: string }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);

export const ClearButton = ({ onClick, className }: { onClick: () => void; className?: string }) => (
  <button type="button" aria-label="Clear search" className={className} onClick={onClick}>
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  </button>
);

/** Search box with its icon and a clear button. `label` is shown above unless `hideLabel`. */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  style,
  hideLabel,
  inputProps,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: CSSProperties;
  hideLabel?: boolean;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <div className={f.root} style={style}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'lbl'}>
        {label}
      </label>
      <div className={f.box}>
        <SearchIcon className={f.icon} />
        <input id={id} type="search" className={f.input} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" {...inputProps} />
        {value && <ClearButton className={f.clear} onClick={() => onChange('')} />}
      </div>
    </div>
  );
}
