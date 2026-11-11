import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  AudioSessionInfoDto,
  DetectedBrowser,
} from "../../../types/media";
import {
  browserDisplayLabel,
  useBrowserControls,
  useBrowsers,
  type BrowserControls,
} from "../../media-dashboard";
import {
  INAPP_BROWSER_ID,
  usePlaylistPlayer,
  type PlaylistPlayerApi,
} from "../../playlist-player";
import { useVault, type VaultApi } from "../../vault";
import type { WidgetState } from "../../widget";
import { summarize, type OverviewStats } from "./browserStats";
import { useWidgetSnapshot } from "./useWidgetSnapshot";

/**
 * God Mode's data layer.
 *
 * Every live source is subscribed to exactly once for the whole window, and
 * each one gets its own context. The split is the performance contract: the
 * browser stream ticks several times a second while anything plays, and a
 * single combined context would re-render the History, Bookmarks and
 * Playlists sections on every tick. With one provider per source, a source
 * changing re-renders only its own consumers — React bails out of the rest of
 * the tree because each provider's `children` element is unchanged.
 *
 * Nothing here owns data: Rust is the source of truth for all of it, and
 * these are the same hooks the dashboard uses.
 */

export type LiveBrowsers = {
  browsers: DetectedBrowser[];
  browserAudio: Record<string, AudioSessionInfoDto>;
  stats: OverviewStats;
  controls: BrowserControls;
};

const BrowsersContext = createContext<LiveBrowsers | null>(null);
/** `osBrowserId` → icon URL. Changes only when an icon does, not per tick. */
export type BrowserIcons = ReadonlyMap<string, string>;
const BrowserIconsContext = createContext<BrowserIcons>(new Map());

/** A browser whose companion is connected right now — somewhere to play. */
export type ConnectedBrowser = { id: string; label: string };
const ConnectedBrowsersContext = createContext<readonly ConnectedBrowser[]>([]);
const VaultContext = createContext<VaultApi | null>(null);
const PlayerContext = createContext<PlaylistPlayerApi | null>(null);
const WidgetContext = createContext<WidgetState | null | undefined>(undefined);

function BrowsersProvider({ children }: { children: ReactNode }) {
  const { browsers, browserAudio } = useBrowsers();
  const controls = useBrowserControls(browsers);
  const stats = useMemo(() => summarize(browsers), [browsers]);
  const value = useMemo<LiveBrowsers>(
    () => ({ browsers, browserAudio, stats, controls }),
    [browsers, browserAudio, stats, controls],
  );
  const icons = useStableIcons(browsers);
  const connected = useStableConnected(browsers);
  return (
    <BrowsersContext.Provider value={value}>
      <BrowserIconsContext.Provider value={icons}>
        <ConnectedBrowsersContext.Provider value={connected}>
          {children}
        </ConnectedBrowsersContext.Provider>
      </BrowserIconsContext.Provider>
    </BrowsersContext.Provider>
  );
}

/** Connected real browsers, stable until one connects, leaves or is renamed. */
function useStableConnected(browsers: readonly DetectedBrowser[]): readonly ConnectedBrowser[] {
  const signature = browsers
    .filter((b) => b.extensionConnected && b.id !== INAPP_BROWSER_ID)
    .map((b) => `${b.id}\u0000${browserDisplayLabel(b)}`)
    .join("\n");
  return useMemo(
    () =>
      signature
        ? signature.split("\n").map((line) => {
            const [id, label] = line.split("\u0000");
            return { id, label };
          })
        : [],
    [signature],
  );
}

/**
 * Browser icons by OS browser id, as a value that keeps its identity across
 * browser ticks. History and the vault show "which browser" on every row and
 * must not re-render because a tab somewhere advanced a second.
 */
function useStableIcons(browsers: readonly DetectedBrowser[]): BrowserIcons {
  const signature = browsers
    .map((b) => `${b.osBrowserId}=${b.iconUrl ?? ""}`)
    .sort()
    .join("\n");
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const line of signature.split("\n")) {
      const at = line.indexOf("=");
      const id = line.slice(0, at);
      const url = line.slice(at + 1);
      if (id && url && !map.has(id)) map.set(id, url);
    }
    return map;
  }, [signature]);
}

function VaultProvider({ children }: { children: ReactNode }) {
  const vault = useVault();
  return <VaultContext.Provider value={vault}>{children}</VaultContext.Provider>;
}

function PlayerProvider({ children }: { children: ReactNode }) {
  const player = usePlaylistPlayer();
  return <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>;
}

function WidgetProvider({ children }: { children: ReactNode }) {
  const widget = useWidgetSnapshot();
  return <WidgetContext.Provider value={widget}>{children}</WidgetContext.Provider>;
}

/** Mount once at the root of the God Mode window. */
export function GodModeDataProvider({ children }: { children: ReactNode }) {
  return (
    <BrowsersProvider>
      <VaultProvider>
        <PlayerProvider>
          <WidgetProvider>{children}</WidgetProvider>
        </PlayerProvider>
      </VaultProvider>
    </BrowsersProvider>
  );
}

function required<T>(value: T | null | undefined, name: string): T {
  if (value == null) {
    throw new Error(`${name} must be used inside <GodModeDataProvider>`);
  }
  return value;
}

/** Live browsers, their tabs, totals and the tab controls. Ticks often. */
export function useLiveBrowsers(): LiveBrowsers {
  return required(useContext(BrowsersContext), "useLiveBrowsers");
}

/** Icon for an OS browser id while that browser is detected. Rarely changes. */
export function useBrowserIcons(): BrowserIcons {
  return useContext(BrowserIconsContext);
}

/** Browsers a playlist can play in right now. Rarely changes. */
export function useConnectedBrowsers(): readonly ConnectedBrowser[] {
  return useContext(ConnectedBrowsersContext);
}

/** The vault snapshot plus every vault mutation. Changes on `vault://update`. */
export function useVaultData(): VaultApi {
  return required(useContext(VaultContext), "useVaultData");
}

/** The playlist player session and its commands. */
export function usePlayer(): PlaylistPlayerApi {
  return required(useContext(PlayerContext), "usePlayer");
}

/** Read-only widget state; `null` until the first broadcast arrives. */
export function useWidget(): WidgetState | null {
  const value = useContext(WidgetContext);
  if (value === undefined) {
    throw new Error("useWidget must be used inside <GodModeDataProvider>");
  }
  return value;
}
