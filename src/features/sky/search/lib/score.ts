import { foldWithMap, isWordChar } from "./text";

/**
 * Relevance scoring shared by every kind of result, so a tab, a bookmark and
 * a history entry with the same title rank the same way — and so a
 * section's own filter box agrees with the global search.
 *
 * A document is a few folded fields with weights. Every term must match some
 * field (AND); each term scores by its best field and by how well it matches
 * there: the whole field, the field's start, the start of a word, or anywhere.
 */

export type SearchField = {
  /** Already folded (see `fold`). */
  text: string;
  /** 0–1: how much a match here says about the document. */
  weight: number;
};

const QUALITY_EXACT = 1;
const QUALITY_PREFIX = 0.9;
const QUALITY_WORD = 0.75;
const QUALITY_INSIDE = 0.45;

/** How well `term` matches `text` (0 = not at all). */
export function matchQuality(text: string, term: string): number {
  if (!term) return 0;
  let index = text.indexOf(term);
  if (index === -1) return 0;
  if (index === 0) return text.length === term.length ? QUALITY_EXACT : QUALITY_PREFIX;
  // Look for a word-start occurrence before settling for a mid-word one.
  while (index !== -1) {
    if (!isWordChar(text[index - 1])) return QUALITY_WORD;
    index = text.indexOf(term, index + 1);
  }
  return QUALITY_INSIDE;
}

/**
 * Score a document: 0 when any term is missing, otherwise up to 100.
 * With no terms every document matches with a neutral score, so filters
 * (site:, is:) can be applied on their own.
 */
export function scoreFields(fields: readonly SearchField[], terms: readonly string[]): number {
  if (terms.length === 0) return 1;
  let total = 0;
  for (const term of terms) {
    let best = 0;
    for (const field of fields) {
      if (!field.text) continue;
      const q = matchQuality(field.text, term) * field.weight;
      if (q > best) best = q;
    }
    if (best === 0) return 0;
    total += best;
  }
  return (total / terms.length) * 100;
}

export type TextRange = { start: number; end: number };

/**
 * Where the terms occur in `value`, merged and in order — for drawing
 * highlights on the original (unfolded) text.
 */
export function highlightRanges(value: string, terms: readonly string[]): TextRange[] {
  if (!value || terms.length === 0) return [];
  const { text, map } = foldWithMap(value);
  const raw: TextRange[] = [];
  for (const term of terms) {
    if (!term) continue;
    let index = text.indexOf(term);
    while (index !== -1) {
      const start = map[index];
      const lastFolded = index + term.length - 1;
      const end =
        lastFolded + 1 < map.length ? map[lastFolded + 1] : value.length;
      raw.push({ start, end: Math.max(end, start + 1) });
      index = text.indexOf(term, index + term.length);
    }
  }
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: TextRange[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}
