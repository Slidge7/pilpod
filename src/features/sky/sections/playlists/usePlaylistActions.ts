import { useCallback, useMemo, useState } from "react";
import type { StartTarget } from "../../../playlist-player";
import { useConnectedBrowsers, usePlayer } from "../../data/SkyData";
import type { TargetOption } from "./components/PlayButton";

/** `"inapp"` or `"b:<browserId>"`. */
export type PlayTarget = string;
const IN_APP: PlayTarget = "inapp";

function toStart(target: PlayTarget): StartTarget {
  return target === IN_APP ? { target: "inApp" } : { target: "browser", browserId: target.slice(2) };
}

/**
 * Starting playlists from Sky: where they play, and the commands. Reads
 * the connected-browser list, which changes only when a browser connects or
 * leaves — never the per-tick tab stream.
 */
export function usePlaylistActions() {
  const connected = useConnectedBrowsers();
  const player = usePlayer();
  const [picked, setPicked] = useState<PlayTarget>(IN_APP);
  const [starting, setStarting] = useState<string | null>(null);

  const options = useMemo<TargetOption[]>(
    () => [
      { value: IN_APP, label: "In PilPod" },
      ...connected.map((b) => ({ value: `b:${b.id}`, label: `In ${b.label}` })),
    ],
    [connected],
  );

  // A browser that disconnects while picked falls back to PilPod's player.
  const target = options.some((o) => o.value === picked) ? picked : IN_APP;

  const { start, playItem } = player;
  const play = useCallback(
    async (playlistId: string, opts: { shuffle?: boolean; fromItemId?: string } = {}) => {
      setStarting(playlistId);
      try {
        const ok = await start(playlistId, toStart(target), { shuffle: opts.shuffle ?? false });
        if (ok && opts.fromItemId) await playItem(opts.fromItemId);
      } finally {
        setStarting(null);
      }
    },
    [start, playItem, target],
  );

  return { options, target, setTarget: setPicked, play, starting, player };
}
