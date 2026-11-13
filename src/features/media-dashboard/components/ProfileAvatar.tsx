import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./ProfileAvatar.css";
import type { BrowserProfileInfo } from "../../../types/media";
import { profileInitial, profileTooltip } from "../lib/browserProfiles";

/**
 * Avatar pictures are fetched on demand (`get_browser_profile_avatar`) rather
 * than shipped in every `browsers://update`, which fires on each tab change.
 * The key changes whenever the picture file does, so cached entries never go
 * stale; a miss (no picture / unreadable) is cached as `null`.
 */
const avatarCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function loadAvatar(key: string): Promise<string | null> {
  const cached = avatarCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  let pending = inflight.get(key);
  if (!pending) {
    pending = invoke<string | null>("get_browser_profile_avatar", { key })
      .catch(() => null)
      .then((url) => {
        const value = url ?? null;
        avatarCache.set(key, value);
        inflight.delete(key);
        return value;
      });
    inflight.set(key, pending);
  }
  return pending;
}

/** `data:` URL of a profile's picture, or `null` while loading / when it has none. */
export function useProfileAvatar(key?: string | null): string | null {
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!key || avatarCache.has(key)) return;
    let live = true;
    void loadAvatar(key).then((url) => {
      if (live) setLoaded({ key, url });
    });
    return () => {
      live = false;
    };
  }, [key]);

  if (!key) return null;
  const cached = avatarCache.get(key);
  if (cached !== undefined) return cached;
  return loaded?.key === key ? loaded.url : null;
}

type Props = {
  profile: BrowserProfileInfo;
  /** Pixel size (square). */
  size?: number;
  className?: string;
  /** Hover text; defaults to name + account. Pass `null` for none. */
  title?: string | null;
};

/**
 * A browser profile's picture, or its initial on the profile colour — the same
 * cue the browser itself uses in its profile menu.
 */
export function ProfileAvatar({ profile, size = 16, className, title }: Props) {
  const url = useProfileAvatar(profile.avatarKey);
  const hover = title === undefined ? profileTooltip(profile) : title ?? undefined;
  const classes = ["pilpod-profile-avatar", className].filter(Boolean).join(" ");
  const box: CSSProperties = { width: size, height: size };

  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={classes}
        style={box}
        width={size}
        height={size}
        title={hover}
        draggable={false}
      />
    );
  }

  const initialStyle: CSSProperties = {
    ...box,
    fontSize: Math.max(8, Math.round(size * 0.58)),
    ...(profile.color ? { backgroundColor: profile.color } : {}),
  };
  return (
    <span
      className={`${classes} pilpod-profile-avatar--initial`}
      style={initialStyle}
      title={hover}
      aria-hidden
    >
      {profileInitial(profile.name)}
    </span>
  );
}
