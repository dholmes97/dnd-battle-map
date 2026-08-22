"use client";

import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

const dialogStack: HTMLElement[] = [];
type PointerTracker = { lastTarget: HTMLElement | null };
const pointerTracker = initializePointerTracker();

type InertSnapshot = {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
};

export function ModalDialog({
  children,
  labelledBy,
  describedBy,
  role = "dialog",
  backdropClassName = "confirm-backdrop",
  dialogClassName = "confirm-dialog",
  initialFocus = "first",
  closeOnBackdrop = false,
  closeOnEscape = true,
  onDismiss,
}: {
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
  role?: "dialog" | "alertdialog";
  backdropClassName?: string;
  dialogClassName?: string;
  initialFocus?: "first" | "dialog";
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  onDismiss?: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const dismissRef = useRef(onDismiss);

  useLayoutEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;
    if (!backdrop || !dialog) return;
    const activeElement = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    const opener = activeElement ?? (pointerTracker?.lastTarget?.isConnected ? pointerTracker.lastTarget : null);
    const inerted = makeOutsideContentInert(backdrop);
    dialogStack.push(dialog);

    const initial = initialFocus === "dialog"
      ? dialog
      : dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
        focusableElements(dialog)[0] ?? dialog;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== dialog) return;
      if (event.key === "Escape" && closeOnEscape && dismissRef.current) {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const index = dialogStack.lastIndexOf(dialog);
      if (index >= 0) dialogStack.splice(index, 1);
      restoreOutsideContent(inerted);
      if (opener?.isConnected) opener.focus();
    };
  }, [closeOnEscape, initialFocus]);

  const onBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (
      closeOnBackdrop &&
      event.target === event.currentTarget &&
      dialogStack.at(-1) === dialogRef.current
    ) dismissRef.current?.();
  };

  return <div ref={backdropRef} className={backdropClassName} role="presentation" onMouseDown={onBackdropMouseDown}>
    <section
      ref={dialogRef}
      className={`modal-dialog-surface ${dialogClassName}`}
      role={role}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      tabIndex={-1}
    >
      {children}
    </section>
  </div>;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) =>
    !element.hidden && element.getAttribute("aria-hidden") !== "true"
  );
}

function makeOutsideContentInert(backdrop: HTMLElement): InertSnapshot[] {
  const snapshots: InertSnapshot[] = [];
  let current: HTMLElement = backdrop;
  while (current.parentElement) {
    const parent = current.parentElement;
    for (const sibling of parent.children) {
      if (!(sibling instanceof HTMLElement) || sibling === current) continue;
      snapshots.push({
        element: sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute("aria-hidden"),
      });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    if (parent === document.body) break;
    current = parent;
  }
  return snapshots;
}

function restoreOutsideContent(snapshots: InertSnapshot[]) {
  for (const { element, inert, ariaHidden } of snapshots.reverse()) {
    element.inert = inert;
    if (ariaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", ariaHidden);
  }
}

function initializePointerTracker(): PointerTracker | null {
  if (typeof window === "undefined") return null;
  const dialogWindow = window as Window & { __dndModalPointerTracker?: PointerTracker };
  if (dialogWindow.__dndModalPointerTracker) return dialogWindow.__dndModalPointerTracker;
  const tracker: PointerTracker = { lastTarget: null };
  document.addEventListener("pointerdown", (event) => {
    tracker.lastTarget = event.target instanceof Element
      ? event.target.closest<HTMLElement>("button, [href], input, select, textarea, summary, [tabindex]")
      : null;
  }, true);
  dialogWindow.__dndModalPointerTracker = tracker;
  return tracker;
}
