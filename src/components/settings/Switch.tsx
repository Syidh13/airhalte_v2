// TIDAK DIPAKAI — template lama, aman dihapus.
"use client";

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}

/**
 * iOS-style toggle implemented as a real <input type="checkbox"> wrapped in
 * a label so it stays keyboard-focusable, screen-reader-friendly, and works
 * inside form submissions. Visual track + thumb are pure CSS pseudo-elements
 * (see `.set-switch` in globals.css).
 */
export default function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: SwitchProps) {
  return (
    <label className="set-switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        disabled={disabled}
      />
      <span className="set-switch-track" aria-hidden="true" />
    </label>
  );
}
