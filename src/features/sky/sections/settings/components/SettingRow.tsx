import { useId, type ReactNode } from "react";

/**
 * One setting: what it is and what it does on the left, the control on the
 * right. `children` receives the ids to label and describe the control with.
 */
export function SettingRow({
  label,
  description,
  children,
  stacked = false,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: (ids: { labelId: string; descriptionId: string | undefined }) => ReactNode;
  /** Put the control under the text (wide controls: galleries, grids). */
  stacked?: boolean;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-desc` : undefined;
  return (
    <div className={`sky-setting${stacked ? " sky-setting--stacked" : ""}`}>
      <div className="sky-setting__text">
        <span className="sky-setting__label" id={labelId}>
          {label}
        </span>
        {description ? (
          <p className="sky-setting__desc" id={descriptionId}>
            {description}
          </p>
        ) : null}
      </div>
      <div className="sky-setting__control">{children({ labelId, descriptionId })}</div>
    </div>
  );
}

/** A titled group of settings. */
export function SettingsCard({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Something small at the top right of the card (a status, a link). */
  aside?: ReactNode;
}) {
  return (
    <section className="sky-settings-card" aria-label={title}>
      <header className="sky-settings-card__head">
        <div>
          <h3 className="sky-settings-card__title">{title}</h3>
          {description ? <p className="sky-settings-card__desc">{description}</p> : null}
        </div>
        {aside ? <div className="sky-settings-card__aside">{aside}</div> : null}
      </header>
      <div className="sky-settings-card__body">{children}</div>
    </section>
  );
}

/** An on/off switch for a {@link SettingRow}. */
export function Switch({
  checked,
  onChange,
  labelId,
  descriptionId,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelId: string;
  descriptionId?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="sky-switch"
      checked={checked}
      disabled={disabled}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}
