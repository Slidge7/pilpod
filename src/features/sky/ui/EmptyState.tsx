import type { ReactNode } from "react";

/** What an empty view says, and the one thing to do about it. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="sky-empty">
      <h3 className="sky-empty__title">{title}</h3>
      {children ? <div className="sky-empty__body">{children}</div> : null}
      {action ? <div className="sky-empty__action">{action}</div> : null}
    </div>
  );
}
