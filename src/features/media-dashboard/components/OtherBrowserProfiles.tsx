import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./OtherBrowserProfiles.css";
import type { BrowserProfileInfo, DetectedBrowser } from "../../../types/media";
import {
  UNCONNECTED_STATUS_TEXT,
  unconnectedProfileGroups,
  type UnconnectedProfile,
} from "../lib/browserProfiles";
import { ProfileAvatar } from "./ProfileAvatar";

type Props = {
  browsers: DetectedBrowser[];
  browserProfiles: Readonly<Record<string, BrowserProfileInfo[]>>;
};

/**
 * Browser profiles that exist on this computer but aren't in the dashboard:
 * the companion isn't added there, is switched off, or isn't connected. One
 * click opens that exact profile — on the companion's store page when it
 * still needs adding.
 */
export function OtherBrowserProfiles({ browsers, browserProfiles }: Props) {
  const groups = useMemo(
    () => unconnectedProfileGroups(browserProfiles, browsers),
    [browserProfiles, browsers],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (groups.length === 0) return null;

  const run = async (osBrowserId: string, item: UnconnectedProfile) => {
    const key = `${osBrowserId}/${item.profile.dir}`;
    setBusy(key);
    setError(null);
    try {
      await invoke("open_browser_profile", {
        osBrowserId,
        profileDir: item.profile.dir,
        addCompanion: item.action === "add",
      });
    } catch (e) {
      setError(typeof e === "string" ? e : "Couldn't open that profile.");
    } finally {
      setBusy((b) => (b === key ? null : b));
    }
  };

  return (
    <section className="pilpod-other-profiles" aria-label="Other browser profiles">
      <h3 className="pilpod-other-profiles__title">Other profiles on this computer</h3>
      {groups.map((group) => (
        <div key={group.osBrowserId} className="pilpod-other-profiles__group">
          <div className="pilpod-other-profiles__browser">
            {group.iconUrl ? (
              <img src={group.iconUrl} alt="" width={14} height={14} />
            ) : null}
            <span>{group.browserName}</span>
          </div>
          <ul className="pilpod-other-profiles__list">
            {group.profiles.map((item) => {
              const key = `${group.osBrowserId}/${item.profile.dir}`;
              return (
                <li key={key} className="pilpod-other-profiles__item">
                  <ProfileAvatar profile={item.profile} size={20} />
                  <span className="pilpod-other-profiles__text">
                    <span className="pilpod-other-profiles__name">{item.profile.name}</span>
                    <span className="pilpod-other-profiles__status">
                      {item.profile.email ? `${item.profile.email} · ` : ""}
                      {UNCONNECTED_STATUS_TEXT[item.status]}
                    </span>
                  </span>
                  {item.action ? (
                    <button
                      type="button"
                      className="pilpod-other-profiles__btn"
                      disabled={busy === key}
                      onClick={() => void run(group.osBrowserId, item)}
                      title={
                        item.action === "add"
                          ? `Open ${item.profile.name} on the companion's store page`
                          : `Open ${group.browserName} in the ${item.profile.name} profile`
                      }
                    >
                      {item.action === "add" ? "Add companion" : "Open"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {error ? <p className="pilpod-other-profiles__error">{error}</p> : null}
    </section>
  );
}
