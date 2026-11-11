/**
 * Tags as typed in a single field: `"react, docs  #css"` → `["react", "docs", "css"]`.
 * Commas or spaces separate; a leading `#` is dropped; duplicates (any case)
 * keep their first spelling.
 */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,\s]+/)) {
    const tag = raw.replace(/^#+/, "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function formatTags(tags: readonly string[]): string {
  return tags.join(", ");
}
