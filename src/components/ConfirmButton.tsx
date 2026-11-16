import { useState, type ReactNode } from "react";
import { Dialog } from "./common";

export interface ConfirmButtonProps {
  className?: string;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
  /** Dialog heading. */
  confirmTitle: string;
  /** What will happen, in plain words. */
  confirmText: ReactNode;
  /** Label of the confirming button. */
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * A button for actions that energise drives or move the machine: it opens a
 * confirmation dialog first. Cancel is focused by default, so Enter/Escape
 * never confirm by accident.
 */
export function ConfirmButton({ className, disabled, title, children, confirmTitle, confirmText, confirmLabel, onConfirm }: ConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} disabled={disabled} title={title} onClick={() => setOpen(true)}>
        {children}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={confirmTitle}>
        <div className="stack">
          <div>{confirmText}</div>
          <div className="btn-row dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)} autoFocus>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-warn"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
