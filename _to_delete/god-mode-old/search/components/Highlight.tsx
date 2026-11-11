import { memo, useMemo } from "react";
import { highlightRanges } from "../lib/score";

/** `text` with every occurrence of the search terms marked. */
function HighlightView({ text, terms }: { text: string; terms: readonly string[] }) {
  const parts = useMemo(() => {
    const ranges = highlightRanges(text, terms);
    if (ranges.length === 0) return null;
    const out: Array<{ text: string; mark: boolean }> = [];
    let at = 0;
    for (const r of ranges) {
      if (r.start > at) out.push({ text: text.slice(at, r.start), mark: false });
      out.push({ text: text.slice(r.start, r.end), mark: true });
      at = r.end;
    }
    if (at < text.length) out.push({ text: text.slice(at), mark: false });
    return out;
  }, [text, terms]);

  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

export const Highlight = memo(HighlightView);
