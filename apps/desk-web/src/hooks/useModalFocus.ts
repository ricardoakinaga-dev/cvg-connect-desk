import { useEffect, useRef } from 'react';

export function useModalFocus(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const rememberTrigger = (element?: HTMLElement | null) => {
    triggerRef.current = element || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  };

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const backdrop = dialog.parentElement;
    const page = backdrop?.parentElement;
    const candidates = [
      document.querySelector<HTMLElement>('.sidebar'),
      document.querySelector<HTMLElement>('.mobile-topbar'),
      ...Array.from(page?.children || []).filter((child): child is HTMLElement => child instanceof HTMLElement && child !== backdrop),
    ].filter((element): element is HTMLElement => !!element);
    const blocked = candidates.map((element) => ({ element, hadInert: element.hasAttribute('inert') }));
    blocked.forEach(({ element }) => element.setAttribute('inert', ''));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]'));
    const frame = requestAnimationFrame(() => (dialog.querySelector<HTMLElement>('[autofocus]') || focusable()[0] || dialog).focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKey);
      blocked.forEach(({ element, hadInert }) => { if (!hadInert) element.removeAttribute('inert'); });
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  return { dialogRef, rememberTrigger };
}
