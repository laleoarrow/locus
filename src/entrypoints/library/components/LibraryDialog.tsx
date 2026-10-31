import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './notes.css';

export function LibraryDialog({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose(): void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return createPortal(
    <dialog ref={ref} className="library-dialog" aria-label={title}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button type="button" aria-label="Close" disabled={busy} onClick={onClose}>×</button>
      </div>
      {children}
    </dialog>, document.body,
  );
}
