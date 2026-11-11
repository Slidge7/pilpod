import { useLayoutEffect, useRef, type ReactNode } from "react";

type Props = {
  title: ReactNode;
  /** One short line under the title: counts, state. */
  meta?: ReactNode;
  /** Controls on the right of the title row. */
  actions?: ReactNode;
  /** A second row under the title (filters, segmented controls). */
  toolbar?: ReactNode;
  children: ReactNode;
  /** Label for the scroll region, for screen readers. */
  label: string;
};

/**
 * The frame every section shares: a title row, an optional toolbar, and one
 * scrolling body. Sections are kept alive while hidden; the body remembers
 * its scroll position across that (a hidden element loses it otherwise).
 */
export function SectionLayout({ title, meta, actions, toolbar, children, label }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);

  // Restore on (re)show. The position is recorded while scrolling, not on
  // hide: by the time a hidden section's cleanup runs it may already be
  // display:none, which reads as scrollTop 0.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && scrollTop.current > 0) el.scrollTop = scrollTop.current;
  }, []);

  return (
    <div className="gm-view">
      <header className="gm-view__head">
        <div className="gm-view__titles">
          <h2 className="gm-view__title">{title}</h2>
          {meta ? <p className="gm-view__meta">{meta}</p> : null}
        </div>
        {actions ? <div className="gm-view__actions">{actions}</div> : null}
      </header>
      {toolbar ? <div className="gm-view__toolbar">{toolbar}</div> : null}
      <div
        className="gm-view__body"
        ref={bodyRef}
        role="region"
        aria-label={label}
        onScroll={(e) => {
          scrollTop.current = e.currentTarget.scrollTop;
        }}
      >
        {children}
      </div>
    </div>
  );
}
