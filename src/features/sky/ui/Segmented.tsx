import type { ReactNode } from "react";

type Option<T extends string> = { value: T; label: ReactNode; title?: string };

/** A row of mutually exclusive choices (radio semantics). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
}: {
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="sky-segmented" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="sky-segmented__option"
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
