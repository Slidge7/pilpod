/** DOM id for a browser profile card (scroll target). */
export function browserProfileDomId(browserId: string): string {
  return `browser-profile-${browserId}`;
}

/** Scroll the dashboard list so the given browser profile card is visible. */
export function scrollToBrowserProfile(browserId: string): boolean {
  const el = document.getElementById(browserProfileDomId(browserId));
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}
