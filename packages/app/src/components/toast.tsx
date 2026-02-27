'use client';

import { useEffect, useCallback } from 'react';
import { useToastStore, type Toast } from '@/lib/toast-store';

const TOAST_DURATION_MS = 5_000;

const typeStyles: Record<Toast['type'], string> = {
  error: 'bg-red-900/90 border-red-700 text-red-100',
  success: 'bg-green-900/90 border-green-700 text-green-100',
  info: 'bg-blue-900/90 border-blue-700 text-blue-100',
};

const typeIcon: Record<Toast['type'], string> = {
  error: '✕',
  success: '✓',
  info: 'ℹ',
};

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast);

  const dismiss = useCallback(() => {
    removeToast(toast.id);
  }, [removeToast, toast.id]);

  useEffect(() => {
    const timer = setTimeout(dismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [dismiss]);

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg transition-all duration-300 ${
        typeStyles[toast.type]
      }`}
      role="alert"
    >
      <span className="mt-0.5 shrink-0 text-sm font-bold">{typeIcon[toast.type]}</span>
      <p className="flex-1 text-sm">{toast.message}</p>
      <button
        onClick={dismiss}
        className="shrink-0 text-current opacity-60 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
