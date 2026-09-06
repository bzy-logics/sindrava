import { useEffect, useRef, type ReactNode } from "react";
import type { RobotState } from "../types/api";

export function StateBadge({ state }: { state: RobotState | null }) {
  const s = state ?? "disconnected";
  return <span className={`badge state-${s}`}>{s.replace("_", " ")}</span>;
}

export type Tone = "ok" | "warn" | "err" | "info";

export function Led({ on, color = "ok", label }: { on: boolean; color?: Tone; label: string }) {
  return (
    <span className="led-wrap" title={`${label}: ${on ? "yes" : "no"}`}>
      <span className={`led ${on ? `led-${color}` : ""}`} aria-hidden />
      {label}
    </span>
  );
}

export function Chip({ tone, children, title }: { tone?: Tone | "dim"; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${tone ? `chip-${tone}` : ""}`} title={title}>
      {children}
    </span>
  );
}

export function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="muted">—</span>;
  return (
    <span className="chips">
      {items.map((x) => (
        <Chip key={x}>{x}</Chip>
      ))}
    </span>
  );
}

/** Number with fixed digits, "—" when missing/non-finite. */
export function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

/** String or "—" when empty/null (MCU strings are "" until identified). */
export function txt(s: string | null | undefined): string {
  return s ? s : "—";
}

export function fmtUnix(sec: number | null): string {
  if (sec === null) return "—";
  return new Date(sec * 1000).toLocaleString();
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Panel({ title, actions, className, children }: { title: ReactNode; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`panel ${className ?? ""}`}>
      <div className="panel-head">
        <h2>{title}</h2>
        {actions && <div className="panel-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Definition-list row for `<dl className="kv">`. */
export function Row({ k, v, warn }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className={warn ? "warn-text" : undefined}>{v}</dd>
    </>
  );
}

/** Modal dialog using the native <dialog> element (focus trap + Esc). */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-label={title}>
      {open && (
        <>
          <h2 className="dialog-title">{title}</h2>
          {children}
        </>
      )}
    </dialog>
  );
}
