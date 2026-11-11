import { useCallback, useDeferredValue, useMemo, useState } from "react";
import "./Playlists.css";
import type { MediaItem } from "../../../vault";
import { useVaultData } from "../../data/SkyData";
import { useSectionIntent } from "../../navigation/Navigation";
import { SectionSidebar } from "../../navigation/SidebarSlot";
import { parseQuery } from "../../search/lib/query";
import { EmptyState } from "../../ui/EmptyState";
import { FilterInput } from "../../ui/FilterInput";
import { InlineCreate } from "../../ui/InlineCreate";
import { plural } from "../../ui/format";
import { SectionLayout } from "../../ui/SectionLayout";
import { PlayerBar } from "./components/PlayerBar";
import { PlaylistCard } from "./components/PlaylistCard";
import { PlaylistDetail } from "./components/PlaylistDetail";
import type { TrackActions } from "./components/TrackRow";
import { filterPlaylists, summarizePlaylist, type PlaylistSummary } from "./lib/playlistView";
import { usePlaylistActions } from "./usePlaylistActions";

/**
 * Playlists — the vault's playlists as covers, each opening to its track
 * list, with the player session on top while one plays.
 */
export default function PlaylistsSection() {
  const vault = useVaultData();
  const { playlists, mediaItems } = vault.vault;
  const play = usePlaylistActions();
  const { player } = play.player;

  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  useSectionIntent("playlists", (intent) => {
    if (intent.playlistId !== undefined) {
      setOpenId(intent.playlistId);
      setSearch("");
    }
    if (intent.search !== undefined) setSearch(intent.search);
  });

  const mediaById = useMemo(() => new Map(mediaItems.map((m) => [m.id, m])), [mediaItems]);
  const summaries = useMemo(() => {
    const map = new Map<string, PlaylistSummary>();
    for (const p of playlists) map.set(p.id, summarizePlaylist(p, mediaById));
    return map;
  }, [playlists, mediaById]);

  const terms = useMemo(() => parseQuery(deferredSearch).terms, [deferredSearch]);
  const matches = useMemo(
    () => filterPlaylists(playlists, mediaById, deferredSearch),
    [playlists, mediaById, deferredSearch],
  );

  const open = openId ? (playlists.find((p) => p.id === openId) ?? null) : null;
  const livePlaylistId = player.active ? (player.playlistId ?? null) : null;
  const livePlaylist = livePlaylistId ? (playlists.find((p) => p.id === livePlaylistId) ?? null) : null;
  const currentItem = player.currentItemId ? (mediaById.get(player.currentItemId) ?? null) : null;
  const totalTracks = useMemo(() => new Set(playlists.flatMap((p) => p.itemIds)).size, [playlists]);

  const { openEntry, removeFromPlaylist, deletePlaylist, createPlaylist, updatePlaylist, reorderPlaylist } = vault;
  const { playItem } = play.player;
  const startPlaylist = play.play;

  const openPlaylist = useCallback((id: string) => {
    setOpenId(id);
    setSearch("");
  }, []);
  const playPlaylist = useCallback((id: string) => void startPlaylist(id), [startPlaylist]);

  const trackActions = useMemo<TrackActions | null>(() => {
    if (!open) return null;
    return {
      play: (item: MediaItem) =>
        livePlaylistId === open.id
          ? void playItem(item.id)
          : void startPlaylist(open.id, { fromItemId: item.id }),
      open: (item: MediaItem) => void openEntry(item.url, item.normalizedUrl),
      remove: (item: MediaItem) => void removeFromPlaylist(open.id, item.id),
    };
  }, [open, livePlaylistId, playItem, startPlaylist, openEntry, removeFromPlaylist]);

  return (
    <>
      <SectionSidebar>
        <nav className="sky-subnav" aria-label="Playlists">
          <h2 className="sky-sidebar__heading">Playlists</h2>
          <ul>
            <li>
              <button type="button" className="sky-subnav__item" aria-current={open === null ? "true" : undefined} onClick={() => setOpenId(null)}>
                <span className="sky-subnav__glyph" aria-hidden="true">▦</span>
                <span className="sky-subnav__label">All playlists</span>
                <span className="sky-subnav__count">{playlists.length}</span>
              </button>
            </li>
            {playlists.map((p) => (
              <li key={p.id}>
                <button type="button" className="sky-subnav__item" aria-current={open?.id === p.id ? "true" : undefined} onClick={() => openPlaylist(p.id)}>
                  <span className="sky-subnav__glyph" aria-hidden="true">
                    {p.emoji || p.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="sky-subnav__label">{p.name}</span>
                  {p.id === livePlaylistId ? (
                    <span className="sky-eq sky-subnav__eq" aria-label="Playing">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <span className="sky-subnav__count">{p.itemIds.length}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <InlineCreate
            label="New playlist"
            placeholder="Playlist name"
            onCreate={async (name) => {
              const id = await createPlaylist(name);
              if (id) openPlaylist(id);
              return id !== null;
            }}
          />
        </nav>
      </SectionSidebar>

      <SectionLayout
        label="Playlists"
        title="Playlists"
        meta={
          open
            ? undefined
            : search.trim()
              ? `${plural(matches.length, "playlist")} match`
              : `${plural(playlists.length, "playlist")} · ${plural(totalTracks, "track")}`
        }
        actions={
          <FilterInput
            value={search}
            onChange={setSearch}
            placeholder={open ? "Filter tracks" : "Filter playlists and tracks"}
            label={open ? "Filter tracks" : "Filter playlists"}
          />
        }
      >
        <PlayerBar playlist={livePlaylist} current={currentItem} onOpenPlaylist={openPlaylist} />

        {open && trackActions ? (
          <PlaylistDetail
            playlist={open}
            summary={summaries.get(open.id) ?? { tracks: [], totalSecs: 0, artworks: [] }}
            terms={terms}
            live={livePlaylistId === open.id}
            currentItemId={player.currentItemId ?? null}
            starting={play.starting === open.id}
            target={play.target}
            targetOptions={play.options}
            onTarget={play.setTarget}
            onPlay={(shuffle) => void startPlaylist(open.id, { shuffle })}
            onBack={() => setOpenId(null)}
            onRename={(name) => updatePlaylist(open.id, { name })}
            onReorder={(itemIds) => void reorderPlaylist(open.id, itemIds)}
            onDelete={() => {
              void deletePlaylist(open.id);
              setOpenId(null);
            }}
            trackActions={trackActions}
          />
        ) : playlists.length === 0 ? (
          <EmptyState title="No playlists yet">
            Create one in the sidebar, then add videos and music from a tab’s save menu in the dashboard.
          </EmptyState>
        ) : matches.length === 0 ? (
          <EmptyState
            title="No playlist matches"
            action={
              <button type="button" className="sky-btn" onClick={() => setSearch("")}>
                Show all playlists
              </button>
            }
          >
            No playlist name or track fits “{search.trim()}”.
          </EmptyState>
        ) : (
          <div className="sky-pl-grid">
            {matches.map(({ playlist, matchingTracks }) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                summary={summaries.get(playlist.id)!}
                matching={terms.length > 0 ? matchingTracks : null}
                live={playlist.id === livePlaylistId}
                starting={play.starting === playlist.id}
                onOpen={openPlaylist}
                onPlay={playPlaylist}
              />
            ))}
          </div>
        )}
      </SectionLayout>
    </>
  );
}
