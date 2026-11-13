import type {
  BrowserProfileInfo,
  DetectedBrowser,
} from "../../../types/media";

/** First letter of a profile name, for the coloured fallback avatar. */
export function profileInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : "?";
}

/** Hover text for a profile: name, then the signed-in account if any. */
export function profileTooltip(profile: BrowserProfileInfo): string {
  const parts = [profile.name];
  if (profile.email) parts.push(profile.email);
  else if (profile.accountName && profile.accountName !== profile.name) {
    parts.push(profile.accountName);
  }
  return parts.join(" — ");
}

/** Why a profile has no live row. */
export type UnconnectedStatus =
  | "notInstalled" // companion not added to this profile
  | "disabled" // added, but switched off in the browser
  | "notConnected"; // added and on, but not talking to PilPod (closed, or bridge off)

/** What the row's button does: add the companion, or just open the profile. */
export type UnconnectedAction = "add" | "open" | null;

export type UnconnectedProfile = {
  profile: BrowserProfileInfo;
  status: UnconnectedStatus;
  action: UnconnectedAction;
};

export type UnconnectedProfileGroup = {
  osBrowserId: string;
  browserName: string;
  iconUrl: string | null;
  profiles: UnconnectedProfile[];
};

export function unconnectedStatus(profile: BrowserProfileInfo): UnconnectedStatus {
  if (profile.companion === "notInstalled") return "notInstalled";
  if (profile.companion === "disabled") return "disabled";
  return "notConnected";
}

export function unconnectedAction(
  profile: BrowserProfileInfo,
  status: UnconnectedStatus,
): UnconnectedAction {
  if (!profile.canLaunch) return null;
  return status === "notInstalled" ? "add" : "open";
}

export const UNCONNECTED_STATUS_TEXT: Record<UnconnectedStatus, string> = {
  notInstalled: "Companion not added",
  disabled: "Companion turned off",
  notConnected: "Not connected",
};

/**
 * Profiles that exist on disk but have no row in the dashboard, grouped by
 * browser in dashboard order. Only browsers with more than one profile are
 * listed: a single-profile browser without the companion already shows its
 * own "no extension" row.
 */
export function unconnectedProfileGroups(
  byBrowser: Record<string, BrowserProfileInfo[]>,
  browsers: DetectedBrowser[],
): UnconnectedProfileGroup[] {
  const rowIds = new Set(browsers.map((b) => b.id));
  const order: string[] = [];
  for (const b of browsers) {
    if (!order.includes(b.osBrowserId)) order.push(b.osBrowserId);
  }
  for (const os of Object.keys(byBrowser).sort()) {
    if (!order.includes(os)) order.push(os);
  }

  const groups: UnconnectedProfileGroup[] = [];
  for (const os of order) {
    const all = byBrowser[os];
    if (!all || all.length < 2) continue;
    const missing = all.filter((p) => !p.browserId || !rowIds.has(p.browserId));
    if (missing.length === 0) continue;
    const row = browsers.find((b) => b.osBrowserId === os);
    groups.push({
      osBrowserId: os,
      browserName: row?.displayName ?? os,
      iconUrl: row?.iconUrl ?? null,
      profiles: missing.map((profile) => {
        const status = unconnectedStatus(profile);
        return { profile, status, action: unconnectedAction(profile, status) };
      }),
    });
  }
  return groups;
}
