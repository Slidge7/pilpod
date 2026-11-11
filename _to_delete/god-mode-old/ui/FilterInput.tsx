import { useRef } from "react";
import { IconSearch, IconX } from "../../../shared/ui/icons";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
};

/** A section's own filter box. Escape clears it. */
export function FilterInput({ value, onChange, placeholder, label }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className="gm-filter">
      <IconSearch className="gm-filter__icon" />
      <span className="gm-visually-hidden">{label}</span>
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange("");
          }
        }}
      />
      {value ? (
        <button
          type="button"
          className="gm-filter__clear"
          aria-label="Clear filter"
          title="Clear filter"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
        >
          <IconX />
        </button>
      ) : null}
    </label>
  );
}
