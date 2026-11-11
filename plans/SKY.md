# PilPod Sky — design notes

One large window over everything PilPod sees and keeps: every browser, window
and tab live; history; the vault's bookmarks and playlists; and one search
across all of it. Opened with `open_sky_window` (`src-tauri/src/sky.rs`).
It owns no data — everything comes from the same Rust broadcasts and commands
the dashboard uses.

## Layout (`src/features/sky/`)

```
SkyApp.tsx       providers + shell, Ctrl+1…4
data/                one subscription per live source, one context each
navigation/          route as plain data, intents, the sidebar slot
search/              universal search — pure engine in lib/, UI in components/
sections/<id>/       one folder per section, self-contained (view, sidebar, css, lib + tests)
shell/               header, sidebar, section host, section registry
ui/                  primitives shared by sections (layout, inputs, thumbs, confirm…)
```

## Performance rules

- **Split contexts.** `useLiveBrowsers` ticks several times a second while
  media plays; vault, player and widget have their own providers so a tick
  never re-renders History, Bookmarks or Playlists. Two derived contexts change
  only when their content does: `useBrowserIcons` (history rows) and
  `useConnectedBrowsers` (playlist targets). Prefer these over
  `useLiveBrowsers` anywhere that is not the Live section.
- **Lazy, kept-alive sections.** Sections load lazily and are preloaded on
  idle. Once visited they stay mounted under React `<Activity>`: hidden ones
  keep state (filters, open playlist, scroll) and render at idle priority.
- **Search costs nothing when closed.** The results panel (and every index)
  mounts only while open. Indexes are rebuilt when data changes, never per
  keystroke; the query is deferred; history is debounced and sequence-guarded.
- **Big lists** use `content-visibility: auto` (cards, days, tracks) and
  memoized rows with stable action objects.

## Search

`search/lib` is pure and unit-tested:

- `query.ts` — the query language: words (AND), `"phrases"`, `site:`,
  `in:tabs|bookmarks|playlists|history`, `is:playing|audible|pinned|media`.
- `score.ts` — one scorer for every kind (exact > prefix > word start >
  inside, weighted per field), plus highlight ranges on the original text.
- `providers.ts` — index + search per kind (tabs, bookmarks, playlists and
  tracks, history rows from the backend, commands).
- `rank.ts` — groups ordered by their best hit; per-group limits.

Results are data (`SearchHit.target`); `useHitActions` is the single place a
hit becomes an action (Enter), a reveal in Sky (Ctrl+Enter) or a row
button. Section filter boxes use the same scorer, so a revealed query finds
the same things.

**Add a search provider:** add a `SearchTarget` variant and group id in
`types.ts`, an indexer + searcher in `providers.ts` (with tests), wire it into
`useUniversalSearch`, and handle the target in `useHitActions`.

## Sections

**Add a section:** create `sections/<id>/<Name>Section.tsx` (default export),
add the id to `SECTION_IDS` in `navigation/route.ts` and an entry in
`shell/sectionRegistry.ts`. Inside the section:

- `SectionLayout` for the title row, toolbar and scrolling body;
- `SectionSidebar` to put controls in the shared sidebar;
- `useSectionIntent(id, apply)` to accept navigation intents (search text,
  a playlist to open, …) from search and other sections.

## Settings

`sections/settings/` holds every PilPod preference: Appearance, Wallpaper,
Idle mode, Floating widget, Browsers (the dashboard's own setup panel) and
Data & privacy. Pages are listed in `sections/settings/pages.ts`; add one
there and its id in `SETTINGS_PAGE_IDS`.

Settings live where they always did (localStorage, or Rust for the widget and
history) and use the dashboard's own hooks. Those hooks now re-read their keys
on `storage` events (`src/shared/useStorageSync.ts`), so a change made in one
window shows in every other at once.

The wallpaper is **configured** here but never shown in Sky:
`useWallpaperSettings` is the preferences alone; the dashboard's
`useWallpaper` adds the image loader and the auto-switch timer, so only the
dashboard loads the image or advances the rotation. The gallery uses small
cached previews (`lib/wallpaperThumbs.ts`, two decodes at a time).

## Saving and controlling

`tabs/` holds what Sky can do to a live tab, used by Live (and search):

- `SaveTargetsPanel` — bookmark into collections / add media to playlists,
  on the dashboard's own rules (`useSaveTargets` in the vault feature).
- `TabControlPanel` — seek, ±10 s, previous/next, play, picture-in-picture,
  volume to 150% (the shared `volumeScale`), mute, reload, wake, copy, close.
  It reads the tab live, so it is only subscribed while open.
- `SaveWindowButton` — a window's pages as a new, dated collection.
- `MixerVolume` — a browser's Windows mixer volume.

Popovers render into a layer inside the shell (`ui/Popover.tsx`) so they keep
Sky's tokens, and are placed by the vault's `useAnchoredMenu`. Track
reordering reuses the player window's pointer-driven `useTrackDrag` (HTML5
drag and drop is unreliable in WebView2 with Tauri's file-drop handler on).

## Possible next steps

- History search is a backend `LIKE` over the whole phrase; the planned FTS5
  index would give it the same every-word matching as the rest of search.
- Rename / reorder playlists and edit bookmark tags from Sky (the vault
  commands exist; the dashboard has the UI).
- Virtualize the Live grid if profiles with thousands of tabs show up.
