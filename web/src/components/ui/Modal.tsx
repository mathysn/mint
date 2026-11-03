import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { prefersReducedMotion } from '../../lib/usePresence';
import { ScrollArea } from './Scrollbar';
import s from './modal.module.css';

const EXIT_MS = 180;

/**
 * Dialog over the page: centred panel on desktop, bottom sheet on mobile. Escape, the backdrop or
 * the close button closes it, after a short exit animation; focus goes to the element marked
 * `data-autofocus` (else the first control) and comes back to where it was on close.
 * Rendered in document.body, so no transformed or faded parent can move it.
 */
export function Modal({
  label,
  mobile,
  width = 760,
  onClose,
  children,
}: {
  /** HUD label of the header ("Add to showcase"), also the dialog's accessible name. */
  label: string;
  mobile?: boolean;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    if (prefersReducedMotion()) return close.current();
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => close.current(), EXIT_MS);
  }, []);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const target = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('[data-modal-body] input, [data-modal-body] button, [data-modal-body] a[href]');
    (target ?? box.current?.querySelector<HTMLElement>('button'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [requestClose]);

  return createPortal(
    <>
      <div className={s.backdrop} data-closing={closing || undefined} onClick={requestClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-closing={closing || undefined}
        className={`${s.dialog} ${mobile ? s.sheet : s.centered}`}
        style={mobile ? undefined : { width: `min(${width}px, calc(100vw - 48px))` }}
      >
        <div className={s.head}>
          <span className="lbl">// {label}</span>
          <button type="button" onClick={requestClose} aria-label="Close" className={s.close}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <ScrollArea className={s.bodyFrame} viewportClassName={s.body} data-modal-body="">
          {children}
        </ScrollArea>
      </div>
    </>,
    document.body,
  );
}
