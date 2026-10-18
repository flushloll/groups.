import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

/** Accessible modal: focus moves in, Tab is trapped, Escape and backdrop close. */
export default function Modal({
  title,
  eyebrow,
  children,
  onClose,
  size = "normal",
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  size?: "normal" | "wide" | "full";
}) {
  const element = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = element.current?.querySelector<HTMLElement>(
      "[autofocus], input, textarea, select, button:not(.modal-close)",
    );
    (first || element.current)?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <section
        ref={element}
        tabIndex={-1}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") close.current();
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), textarea, select, a[href], [tabindex='0']",
            ),
          );
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="modal-head">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          <button className="modal-close icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
