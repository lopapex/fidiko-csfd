import { useEffect, useState } from "react";

const TOAST_EVENT = "nzfd-toast";
const TOAST_MS = 2600;

export const showToast = (message: string) => {
  window.dispatchEvent(new CustomEvent<string>(TOAST_EVENT, { detail: message }));
};

/** One polite live region; the latest message replaces the previous one. */
export function ToastHost() {
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);

  useEffect(() => {
    const onToast = (event: Event) => {
      setToast({ message: (event as CustomEvent<string>).detail, key: Date.now() });
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast ? <div className="toast" key={toast.key}>{toast.message}</div> : null}
    </div>
  );
}
