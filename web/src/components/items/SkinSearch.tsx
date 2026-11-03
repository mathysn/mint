import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { SkinCard, SkinSuggestion, SuggestScope } from '../../../../shared/api';
import { api } from '../../lib/api';
import { RARITY, finishLabel } from '../../lib/rarity';
import { useDebounced } from '../../lib/useDebounced';
import { usePresence } from '../../lib/usePresence';
import { ClearButton, SearchIcon } from '../ui/fields';
import { Halo } from '../ui/primitives';
import f from '../ui/search.module.css';

export const SEARCH_MIN_CHARS = 2;

const words = (q: string) =>
  q
    .toLowerCase()
    .split(/[\s|★]+/)
    .filter(Boolean);

const escapeRegExp = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Bold the parts of `text` the player typed ("MP9 | **Hyd**ra"). */
function highlight(text: string, tokens: string[]): ReactNode {
  if (tokens.length === 0) return text;
  const pattern = new RegExp('(' + tokens.map(escapeRegExp).join('|') + ')', 'gi');
  return text.split(pattern).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

function useSuggestions(scope: SuggestScope, player: string | undefined, q: string, enabled: boolean) {
  const query = q.trim();
  return useQuery({
    queryKey: ['skinSuggest', scope, player ?? null, query.toLowerCase()],
    queryFn: () => {
      const params = new URLSearchParams({ scope, q: query });
      if (player) params.set('player', player);
      return api<SkinSuggestion[]>(`/skins/suggest?${params}`);
    },
    enabled: enabled && query.length >= SEARCH_MIN_CHARS,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: CSSProperties;
};

/**
 * The search field and its suggestion panel (DESIGN.md §3), fed by the caller:
 * `suggestions` for the current text, `settled` once they match it, `hint` for the right column.
 * Picking a suggestion searches its full name.
 */
export function SkinSearchField<S extends { skin: SkinCard }>({
  label,
  value,
  onChange,
  placeholder = 'Weapon or skin',
  style,
  open,
  onOpenChange,
  suggestions,
  settled,
  hint,
  detail,
}: FieldProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: S[] | undefined;
  settled: boolean;
  /** Short text in the right column ("×3", "4 listed"). */
  hint: (s: S) => ReactNode;
  /** Optional third line under the finish (a case name). */
  detail?: (s: S) => ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(-1);
  const long = value.trim().length >= SEARCH_MIN_CHARS;
  const list = long ? (suggestions ?? []) : [];
  const tokens = words(value);
  const showPanel = open && long && (list.length > 0 || settled);
  const panel = usePresence(showPanel, 120);

  const change = (next: string) => {
    onChange(next);
    setActive(-1);
    onOpenChange(true);
  };
  const pick = (s: S) => {
    onChange(s.skin.name);
    onOpenChange(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onOpenChange(true);
      setActive((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter') {
      if (showPanel && active >= 0 && list[active]) {
        e.preventDefault();
        pick(list[active]!);
      } else onOpenChange(false);
    } else if (e.key === 'Escape') {
      // Chrome clears a search field on Escape: the first press only closes the panel.
      if (showPanel) {
        e.preventDefault();
        onOpenChange(false);
      } else if (value) onChange('');
    }
  };

  const listId = `${id}-list`;
  return (
    <div className={f.root} style={style}>
      <label htmlFor={id} className="lbl">
        {label}
      </label>
      <div className={`${f.box} ${showPanel ? f.open : ''}`}>
        <SearchIcon className={f.icon} />
        <input
          ref={input}
          id={id}
          type="search"
          className={f.input}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && active >= 0 ? `${id}-opt-${active}` : undefined}
          onChange={(e) => change(e.target.value)}
          onFocus={() => onOpenChange(true)}
          onBlur={() => onOpenChange(false)}
          onKeyDown={onKeyDown}
        />
        {value && (
          <ClearButton
            className={f.clear}
            onClick={() => {
              onChange('');
              input.current?.focus();
            }}
          />
        )}
        {panel.mounted && (
          // mousedown would blur the field and close the panel before the click lands.
          <div id={listId} role="listbox" aria-label="Suggestions" className={f.panel} data-closing={panel.closing || undefined} onMouseDown={(e) => e.preventDefault()}>
            {list.length === 0 && <div className={f.empty}>No skin matches “{value.trim()}”</div>}
            {list.map((s, i) => {
              const rarity = RARITY[s.skin.tier];
              return (
                <div
                  key={s.skin.id}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`${f.row} ${i === active ? f.rowActive : ''}`}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={() => pick(s)}
                >
                  <span aria-hidden="true" className={f.bar} style={{ background: rarity.color }} />
                  <span className={f.art}>
                    <Halo color={rarity.halo} inset="0 4px" />
                    <img src={s.skin.imageUrl} alt="" loading="lazy" draggable={false} />
                  </span>
                  <span className={f.text}>
                    <span className={f.weapon}>{highlight(s.skin.weaponName, tokens)}</span>
                    <span className={f.finish}>{highlight(finishLabel(s.skin), tokens)}</span>
                    {detail?.(s) && <span className={f.detail}>{detail(s)}</span>}
                  </span>
                  <span className={`mono ${f.count}`}>{hint(s)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Weapon search with suggestions while typing: skins of the inventory being looked at,
 * or skins listed on the market.
 */
export function SkinSearch({
  scope,
  player,
  ...field
}: FieldProps & {
  scope: SuggestScope;
  /** Someone else's inventory (friends only). */
  player?: string;
}) {
  const [open, setOpen] = useState(false);
  const typed = useDebounced(field.value, 150);
  const suggestions = useSuggestions(scope, player, typed, open);
  return (
    <SkinSearchField
      {...field}
      open={open}
      onOpenChange={setOpen}
      suggestions={suggestions.data}
      settled={suggestions.isFetched && !suggestions.isPlaceholderData}
      hint={(s) => (scope === 'market' ? `${s.count} listed` : `×${s.count}`)}
    />
  );
}
