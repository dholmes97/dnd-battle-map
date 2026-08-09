"use client";

import type { ButtonHTMLAttributes } from "react";

type IconActionVariant = "close" | "discard" | "remove" | "delete";
type IconActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  label: string;
  variant: IconActionVariant;
};

function XIcon() {
  return <svg className="icon-action-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 5l10 10M15 5L5 15" /></svg>;
}

function TrashIcon() {
  return <svg className="icon-action-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4.5 6.5h11M8 3.8h4M6.2 6.5l.7 9.5h6.2l.7-9.5M8.5 9v4.5M11.5 9v4.5" /></svg>;
}

export default function IconActionButton({ label, variant, className = "", type = "button", ...props }: IconActionButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`icon-action-button icon-action-${variant}${className ? ` ${className}` : ""}`}
      aria-label={label}
    >
      {variant === "delete" ? <TrashIcon /> : <XIcon />}
    </button>
  );
}
