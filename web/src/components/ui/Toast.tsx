import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import s from './ui.module.css';

interface Toast {
  id: number;
  text: string;
  error: boolean;
  /** Check mark before the text (staff actions: "… · logged"). */
  check: boolean;
  leaving?: boolean;
}

const SHOW_MS = 5000;
const EXIT_MS = 200;

type ShowToast = (text: string, opts?: { error?: boolean; check?: boolean }) => void;

const ToastContext = createContext<ShowToast>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback<ShowToast>((text, opts) => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-2), { id, text, error: Boolean(opts?.error), check: Boolean(opts?.check) }]);
    // Slides out, then leaves the list.
    window.setTimeout(() => setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), SHOW_MS - EXIT_MS);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), SHOW_MS);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={s.toasts} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${s.toast} ${t.error ? s.toastError : ''} ${t.check ? s.toastCheck : ''}`} data-closing={t.leaving || undefined}>
            {t.check && (
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
