/**
 * Detect human-readable browser name from User-Agent / userAgentData.
 */

"use strict";

/** @returns {string} */
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

/** @returns {string[]} */
function _brandNames() {
  return (self.navigator?.userAgentData?.brands ?? []).map((b) =>
    b.brand.toLowerCase(),
  );
}
