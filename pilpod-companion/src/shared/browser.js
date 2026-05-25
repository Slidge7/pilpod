/**
 * Detect human-readable browser name from User-Agent / userAgentData.
 * Order: specific Chromium forks before generic Chrome; Opera GX before Opera.
 *
 * Limitation: Opera GX and Opera share the OPR/ UA token; when brands do not
 * distinguish them, both may report as "Opera" (OS detection uses registry/path).
 */

"use strict";

/** @returns {string} */
export function detectBrowserName() {
  const brands = _brandNames();
  const ua = (self.navigator?.userAgent ?? "").toLowerCase();

  if (brands.some((b) => b.includes("brave"))) return "Brave";
  if (
    brands.some((b) => b.includes("opera gx") || b.includes("operagx")) ||
    ua.includes("opr/") && (ua.includes("gx") || ua.includes("operagx"))
  ) {
    return "Opera GX";
  }
  if (brands.some((b) => b.includes("opera"))) return "Opera";
  if (ua.includes("opr/") || ua.includes("opera/")) return "Opera";

  if (brands.some((b) => b.includes("vivaldi"))) return "Vivaldi";
  if (ua.includes("vivaldi")) return "Vivaldi";

  if (brands.some((b) => b.includes("edge"))) return "Microsoft Edge";
  if (ua.includes("edg/")) return "Microsoft Edge";

  if (brands.some((b) => b.includes("arc"))) return "Arc";
  if (ua.includes("arc/")) return "Arc";

  if (brands.some((b) => b.includes("yandex"))) return "Yandex Browser";
  if (ua.includes("yabrowser")) return "Yandex Browser";

  if (brands.some((b) => b.includes("librewolf"))) return "LibreWolf";
  if (ua.includes("librewolf")) return "LibreWolf";

  if (brands.some((b) => b.includes("waterfox"))) return "Waterfox";
  if (ua.includes("waterfox")) return "Waterfox";

  if (ua.includes("tor browser")) return "Tor Browser";
  if (ua.includes("firefox")) return "Firefox";

  if (ua.includes("chromium")) return "Chromium";
  if (ua.includes("chrome")) return "Google Chrome";
  if (ua.includes("safari")) return "Safari";

  return "Unknown";
}

/** @returns {string[]} */
function _brandNames() {
  return (self.navigator?.userAgentData?.brands ?? []).map((b) =>
    b.brand.toLowerCase(),
  );
}
