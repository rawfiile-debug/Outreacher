'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';

type Toast = { msg: string; kind: 'ok' | 'error' };
const Ctx = createContext<(msg: string, kind?: 'ok' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ msg, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), kind === 'error' ? 6000 : 3000);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast ? <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`} role="status" aria-live="polite">{toast.msg}</div> : null}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
