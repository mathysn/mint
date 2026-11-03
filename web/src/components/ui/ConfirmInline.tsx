import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * Confirmation shown in place of the actions (DESIGN.md: recycling Classified or better).
 * Focuses its first button; Escape cancels.
 */
export function ConfirmInline({ message, children, onCancel, style }: { message: ReactNode; children: ReactNode; onCancel: () => void; style?: CSSProperties }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div ref={box} role="alertdialog" aria-labelledby={id} style={{ animation: 'mint-rise 220ms var(--ease-out) both', ...style }}>
      <div id={id} style={{ display: 'contents' }}>
        {message}
      </div>
      {children}
    </div>
  );
}
