import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DURATION_MS, type Notice } from './notices.js';

export interface Toast extends Notice {
  /** 全域唯一（版本號＋事件序）。 */
  key: string;
}

function ToastItem({
  toast,
  onDismiss,
  onAction,
}: {
  toast: Toast;
  onDismiss: (key: string) => void;
  onAction: (a: NonNullable<Toast['action']>) => void;
}) {
  useEffect(() => {
    const id = window.setTimeout(
      () => {
        onDismiss(toast.key);
      },
      DURATION_MS[toast.action ? 'shop' : toast.kind],
    );
    return () => {
      window.clearTimeout(id);
    };
  }, [toast, onDismiss]);

  return (
    <div className={`toast ${toast.kind}`} role={toast.kind === 'danger' ? 'alert' : 'status'}>
      <span className="toast-icon" aria-hidden="true">
        {toast.icon}
      </span>
      <span className="toast-text">{toast.text}</span>
      {toast.action === 'shop' && (
        <button
          className="toast-action"
          onClick={() => {
            onAction('shop');
            onDismiss(toast.key);
          }}
        >
          看商店
        </button>
      )}
      <button
        className="toast-close"
        aria-label="關閉提示"
        onClick={() => {
          onDismiss(toast.key);
        }}
      >
        ✕
      </button>
    </div>
  );
}

/** 畫面下方的提示列：重大事件與「商店可以買」。掛在 body，不被 3D 區裁切。 */
export function ToastHost({
  toasts,
  onDismiss,
  onAction,
}: {
  toasts: readonly Toast[];
  onDismiss: (key: string) => void;
  onAction: (a: NonNullable<Toast['action']>) => void;
}) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.key} toast={t} onDismiss={onDismiss} onAction={onAction} />
      ))}
    </div>,
    document.body,
  );
}
