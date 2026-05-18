/**
 * @file browser.js
 * Detects the human-readable browser name from User-Agent / userAgentData.
 *
 * Priority order:
 *   1. navigator.userAgentData.brands  (Chromium-family, more reliable)
 *   2. navigator.userAgent string      (fallback, including Firefox / Arc)
 */

"use strict";

/**
 * Returns the browser's display name ("Chrome", "Brave", "Firefox", …).
 * Called once at service-worker startup; result is treated as immutable.
 *
 * @returns {string}
 */
export function detectBrowserName() {
  const brands = _brandNames();

  if (brands.some((b) => b.includes("brave")))   return "Brave";
  if (brands.some((b) => b.includes("opera")))   return "Opera";
  if (brands.some((b) => b.includes("vivaldi"))) return "Vivaldi";
  if (brands.some((b) => b.includes("edge")))    return "Edge";

  const ua = (self.navigator?.userAgent ?? "").toLowerCase();

  if (ua.includes("opr/") || ua.includes("opera/")) return "Opera";
  if (ua.includes("vivaldi"))                        return "Vivaldi";
  if (ua.includes("edg/"))                           return "Edge";
  if (ua.includes("arc/"))                           return "Arc";
  if (ua.includes("firefox"))                        return "Firefox";
  if (ua.includes("chromium"))                       return "Chromium";
  if (ua.includes("chrome"))                         return "Chrome";
  if (ua.includes("safari"))                         return "Safari";

  return "Unknown";
}

/** @returns {string[]} lowercase brand strings from userAgentData */
function _brandNames() {
  return (self.navigator?.userAgentData?.brands ?? []).map((b) =>
    b.brand.toLowerCase(),
  );
}