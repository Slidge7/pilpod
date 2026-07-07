/**
 * URL normalization — the exact mirror of `src-tauri/src/vault/url.rs`.
 *
 * This must stay byte-for-byte equivalent to the Rust implementation: the
 * frontend uses it for the O(1) "is this tab already saved?" lookup, and the
 * backend uses it as the dedupe + live-tab-matching key. Both are validated
 * against the shared vectors in `__tests__/urlVectors.json` (a copy of the Rust
 * `testdata/url_vectors.json`). If you change one side, change the other and
 * update the vectors.
 *
 * Rules: lowercase scheme + host only; strip userinfo and a trailing host dot;
 * drop the default port; drop the fragment; collapse a lone root path and strip
 * trailing slashes; remove tracking params, then sort remaining params by
 * key then value. `www.` is intentionally NOT stripped.
 */

const TRACKING_PARAMS = new Set<string>([
  "gclid", "gclsrc", "dclid", "fbclid", "msclkid", "yclid", "twclid",
  "mc_eid", "mc_cid", "igshid", "_ga", "_gl", "_hsenc", "_hsmi", "spm",
  "vero_id", "wickedid", "oly_enc_id", "oly_anon_id",
]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAMS.has(k);
}

export function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (raw === "") return "";

  const noFrag = raw.split("#", 1)[0];

  let scheme = "";
  let afterScheme = noFrag;
  const schemeIdx = noFrag.indexOf("://");
  if (schemeIdx !== -1) {
    scheme = noFrag.slice(0, schemeIdx).toLowerCase();
    afterScheme = noFrag.slice(schemeIdx + 3);
  }

  let authority = afterScheme;
  let pathQuery = "";
  const slashIdx = afterScheme.indexOf("/");
  if (slashIdx !== -1) {
    authority = afterScheme.slice(0, slashIdx);
    pathQuery = afterScheme.slice(slashIdx);
  }

  // Drop userinfo.
  const atIdx = authority.lastIndexOf("@");
  const hostPort = atIdx !== -1 ? authority.slice(atIdx + 1) : authority;

  let hostRaw = hostPort;
  let port: string | null = null;
  const colonIdx = hostPort.lastIndexOf(":");
  if (colonIdx !== -1) {
    hostRaw = hostPort.slice(0, colonIdx);
    port = hostPort.slice(colonIdx + 1);
  }
  const host = hostRaw.replace(/\.+$/, "").toLowerCase();

  let portOut: string | null = port;
  if ((scheme === "http" && port === "80") || (scheme === "https" && port === "443")) {
    portOut = null;
  }

  let pathRaw = pathQuery;
  let query: string | null = null;
  const qIdx = pathQuery.indexOf("?");
  if (qIdx !== -1) {
    pathRaw = pathQuery.slice(0, qIdx);
    query = pathQuery.slice(qIdx + 1);
  }

  let path = pathRaw;
  if (path === "/") {
    path = "";
  } else {
    while (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
  }

  let queryOut: string | null = null;
  if (query !== null) {
    const pairs: Array<[string, string]> = [];
    for (const kv of query.split("&")) {
      if (kv === "") continue;
      const eq = kv.indexOf("=");
      const key = eq !== -1 ? kv.slice(0, eq) : kv;
      const val = eq !== -1 ? kv.slice(eq + 1) : "";
      if (isTrackingParam(key)) continue;
      pairs.push([key, val]);
    }
    // Sort by key, then value — matches Rust tuple sort.
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    if (pairs.length > 0) {
      queryOut = pairs.map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join("&");
    }
  }

  let out = "";
  if (scheme !== "") out += `${scheme}://`;
  out += host;
  if (portOut !== null) out += `:${portOut}`;
  out += path;
  if (queryOut !== null) out += `?${queryOut}`;
  return out;
}
