import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { telegram } from './api';
import { Icon } from './icons';

export function Sheet({ title, subtitle, children, onClose, busy = false }: {
  title: string; subtitle: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const app = telegram();
    const back = () => { if (!busyRef.current) closeRef.current(); };
    if (app?.isVersionAtLeast('6.1')) { app.BackButton.onClick(back); app.BackButton.show(); }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
      if (app?.isVersionAtLeast('6.1')) { app.BackButton.offClick(back); app.BackButton.hide(); }
    };
  }, []);

  return <dialog ref={ref} className="sheet" aria-labelledby="sheet-title" aria-describedby="sheet-subtitle"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="sheet-inner">
      <div className="sheet-grip" />
      <div className="sheet-heading">
        <div><h2 id="sheet-title">{title}</h2><p id="sheet-subtitle">{subtitle}</p></div>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose} disabled={busy}><Icon name="close" /></button>
      </div>
      {children}
    </div>
  </dialog>;
}
