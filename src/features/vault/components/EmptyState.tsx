import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="pilpod-vault-empty">
      {icon ? <span className="pilpod-vault-empty__icon" aria-hidden>{icon}</span> : null}
      <p className="pilpod-vault-empty__title">{title}</p>
      {hint ? <p className="pilpod-vault-empty__hint">{hint}</p> : null}
    </div>
  );
}
