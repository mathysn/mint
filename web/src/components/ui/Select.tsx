import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '../../lib/usePresence';
import { ScrollArea } from './Scrollbar';
import s from './select.module.css';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Shown before the label (avatar, rarity square…). */
  icon?: ReactNode;
  /** Small mono text on the right ("12 items"). */
  hint?: ReactNode;
  /** Extra words the search box matches. */
  keywords?: string;
}

interface Props<T extends string> {
  /** HUD label above the field; also its accessible name. */
  label?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** A filter field at the top of the list, for long lists. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** `field`: bordered box (filters, forms). `inline`: plain text with a chevron ("Sort: Ending soon"). */
  variant?: 'field' | 'inline';
  /** Inline variant: text before the value ("Sort:"). */
  prefix?: string;
  /** Field height. */
  size?: 40 | 44;
  /** Trigger takes the full width. */
  block?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}

const POPOVER_MAX = 320;
const GAP = 4;

interface Place {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Styled replacement of the native select (DESIGN.md §3): button + listbox in a popover drawn
 * over everything (portal), so sheets and scrollers never clip it. Keyboard: arrows, Home/End,
 * Enter, Escape, type-ahead; `searchable` adds a filter field.
 */
export function Select<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  searchable,
  searchPlaceholder = 'Search',
  variant = 'field',
  prefix,
  size = 40,
  block,
  disabled,
  style,
}: Props<T>) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const presence = usePresence(open, 120);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const typed = useRef({ text: '', at: 0 });

  const selected = options.find((o) => o.value === value) ?? options[0];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.keywords ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

  const measure = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - GAP - 8;
    const above = rect.top - GAP - 8;
    const up = below < Math.min(POPOVER_MAX, 220) && above > below;
    const width = Math.max(rect.width, variant === 'inline' ? 200 : 180);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPlace(
      up
        ? { left, width, bottom: window.innerHeight - rect.top + GAP, maxHeight: Math.min(POPOVER_MAX, above) }
        : { left, width, top: rect.bottom + GAP, maxHeight: Math.min(POPOVER_MAX, below) },
    );
  }, [variant]);

  const openList = () => {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, options.indexOf(selected!)));
    measure();
    setOpen(true);
  };
  const closeList = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);
  const pick = (option: SelectOption<T> | undefined) => {
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    closeList();
  };

  // Focus the search field (or the list) once the popover is on screen.
  useLayoutEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [open, searchable]);

  // Follow the trigger when the page or a scroller moves; close on a click elsewhere.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popRef.current?.contains(target) && !triggerRef.current?.contains(target)) closeList(false);
    };
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, measure, closeList]);

  // Keep the active row visible while moving with the keyboard.
  useEffect(() => {
    if (open) document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);

  const onListKey = (e: KeyboardEvent) => {
    const last = shown.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        if (!searchable) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (!searchable) {
          e.preventDefault();
          setActive(last);
        }
        break;
      case 'Enter':
        e.preventDefault();
        pick(shown[active]);
        break;
      case 'Escape':
        // Handled here: a dialog around the select must not close too.
        e.preventDefault();
        e.stopPropagation();
        closeList();
        break;
      case 'Tab':
        closeList(false);
        break;
      default:
        if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now();
          typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
          const hit = shown.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
          if (hit >= 0) setActive(hit);
        }
    }
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList();
    }
  };

  const listId = `${id}-list`;
  const activeId = shown[active] ? `${id}-opt-${active}` : undefined;
  const name = label ?? ariaLabel;

  const trigger = (
    <button
      ref={triggerRef}
      id={`${id}-btn`}
      type="button"
      className={`${variant === 'inline' ? s.inline : s.field} ${block ? s.block : ''}`}
      style={variant === 'field' ? { height: size } : undefined}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
      onClick={() => (open ? closeList() : openList())}
      onKeyDown={onTriggerKey}
    >
      {prefix && <span className={s.prefix}>{prefix}</span>}
      {selected?.icon}
      <span className={s.value}>{selected?.label}</span>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" className={`${s.chevron} ${open ? s.chevronOpen : ''}`}>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );

  const popover =
    presence.mounted &&
    place &&
    createPortal(
      <div
        ref={popRef}
        className={s.popover}
        style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
        data-up={place.bottom !== undefined ? '' : undefined}
        data-closing={presence.closing || undefined}
      >
        {searchable && (
          <div className={s.searchRow}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" className={s.searchIcon}>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <input
              ref={searchRef}
              className={s.search}
              value={query}
              placeholder={searchPlaceholder}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onListKey}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label={name ? `Search ${name.toLowerCase()}` : 'Search'}
            />
          </div>
        )}
        <ScrollArea
          className={s.listFrame}
          viewportClassName={s.list}
          viewportRef={listRef}
          id={listId}
          role="listbox"
          aria-label={name}
          aria-activedescendant={searchable ? undefined : activeId}
          tabIndex={searchable ? undefined : -1}
          onKeyDown={searchable ? undefined : onListKey}
        >
          {shown.length === 0 && <div className={s.empty}>No match</div>}
          {shown.map((o, i) => (
            <div
              key={o.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`${s.option} ${i === active ? s.optionActive : ''}`}
              onPointerMove={() => i !== active && setActive(i)}
              onClick={() => pick(o)}
            >
              {o.icon}
              <span className={s.optionLabel}>{o.label}</span>
              {o.hint !== undefined && <span className={`mono ${s.hint}`}>{o.hint}</span>}
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" className={s.check} style={{ visibility: o.value === value ? 'visible' : 'hidden' }}>
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </div>
          ))}
        </ScrollArea>
      </div>,
      document.body,
    );

  if (variant === 'inline' || !label) {
    return (
      <span className={s.root} style={style}>
        {trigger}
        {popover}
      </span>
    );
  }
  return (
    <div className={s.fieldRoot} style={style}>
      <label htmlFor={`${id}-btn`} className="lbl">
        {label}
      </label>
      {trigger}
      {popover}
    </div>
  );
}
