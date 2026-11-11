/**
 * Text folding for search: case- and accent-insensitive, so "beyonce" finds
 * "Beyoncé" and "ecole" finds "École". Pure and allocation-light — the tab
 * index is rebuilt on every browser tick while search is open.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;
const HAS_NON_ASCII = /[^\u0000-\u007f]/;

/** Lowercase, strip accents. ASCII input (the common case) skips `normalize`. */
export function fold(value: string | null | undefined): string {
  if (!value) return "";
  const lower = value.toLowerCase();
  return HAS_NON_ASCII.test(lower)
    ? lower.normalize("NFD").replace(COMBINING_MARKS, "")
    : lower;
}

/**
 * {@link fold}, plus where each folded character came from in the original
 * string. Highlighting needs this: folding can change a string's length
 * ("é" may arrive as one character or two), so ranges found in the folded
 * text have to be mapped back before they are drawn on the original.
 */
export function foldWithMap(value: string): { text: string; map: number[] } {
  if (!HAS_NON_ASCII.test(value)) {
    const map = new Array<number>(value.length);
    for (let i = 0; i < value.length; i++) map[i] = i;
    return { text: value.toLowerCase(), map };
  }
  let text = "";
  const map: number[] = [];
  let offset = 0;
  for (const char of value) {
    const folded = fold(char);
    for (let i = 0; i < folded.length; i++) map.push(offset);
    text += folded;
    offset += char.length;
  }
  return { text, map };
}

/** `"music.youtube.com"` — no `www.`, lowercase; `null` for non-web URLs. */
export function hostOf(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

/** True for `host` equal to `site` or a subdomain of it. */
export function hostMatchesSite(host: string | null, site: string): boolean {
  if (!host) return false;
  return host === site || host.endsWith(`.${site}`) || host.includes(site);
}

/** Letters and digits in any script count as "word" characters. */
const WORD_CHAR = /[\p{L}\p{N}]/u;

export function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char);
}
