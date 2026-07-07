# PilPod — Dock View-Switcher, In-Tab Save/Download, Floating Download Card

> Builds on the shipped Vault + Downloader features. Three coordinated UI
> changes, all inside `src/` (no Rust changes expected). Written against the
> current components. Behind no new flags — these replace existing UI, gated by
> the existing `DOWNLOADER_UI_ENABLED` / `VAULT_UI_ENABLED`.

## 0. Decisions (from clarification)

1. **Tab download button → opens the Download panel prefilled** with that tab's
   URL (switches view + seeds the URL + auto-fetches info). No silent download.
2. **Free tier:** the download button is always shown; clicking it lands on the
   Download surface, which is already wrapped in `<PremiumGate>` → upsell.
3. **Non-media (normal) tabs get the bookmark button only.** Download lives on
   media tabs (where yt-dlp is meaningful).
4. **Collapsed browser-dock stack → returns to Media view** (and re-expands).

## 1. Goal

- **Task 1 — Dock becomes the view switcher.** Remove the top
  `Media | Download | Vault` tablist. The bottom dock holds: the browser-icon
  group (one unit, left) and, pinned far-right, a Download icon-button and a
  Vault icon-button (icons only, each its own unit). On any non-Media view the
  browser group collapses into a single stacked button (same icons, visually
  "covered as one"); clicking it returns to Media.
- **Task 2 — In-tab affordances.** Bookmark + Download buttons on media-tab
  cards (right of the PiP button); bookmark-only on normal tab rows (left of the
  reload button). Both give live state feedback (saved/not; downloading/done/idle).
- **Task 3 — Floating download card.** A glass float card (styled like the
  floating media card) at the top of the Media view, above the active-media
  strip. Shows a per-download progress bar + percent, sorted with done/error on
  top; collapsible to a one-line summary (N downloaded); hidden entirely when no
  downloads exist.

## 2. Architectural change (state lifting)

Two hooks currently mounted deep must move up to `MediaDashboard` so every
surface shares one snapshot:

- `useVault()` — **already** mounted in `MediaDashboard` (done in the vault
  work). Reuse `vault.savedUrlSet` / `vault.toggleBookmark` / `vault.addBookmark`.
- `useDownloader()` — **currently mounted inside `DownloadPanel`**. Lift it to
  `MediaDashboard`; pass the returned API down as a prop to `DownloadPanel`
  (refactor it to accept `dl: DownloaderApi` instead of calling the hook) and to
  the new floating card. One instance = one event listener, one source of truth.
  - Add `export type DownloaderApi = ReturnType<typeof useDownloader>` to
    `useDownloader.ts`.
  - Free users: `dl_get_queue` errors (premium-gated) and is caught → empty
    tasks → the float card simply never shows. No special-casing needed.

A small "seed URL" channel for prefilling downloads:
- `MediaDashboard` owns `const [downloadSeed, setDownloadSeed] = useState<string|null>(null)`.
- Starting a download from a tab: `setDownloadSeed(tab.url); setActiveView("download")`.
- `DownloadPanel` gains a `seedUrl?: string | null` prop + `onSeedConsumed()`;
  an effect fetches info when `seedUrl` changes, then clears it.

## 3. Phase A — Dock as view switcher

**Files:** `MediaDashboard.tsx`, `components/BrowserDockBar.tsx` + `.css`,
`shared/ui/icons.tsx`, `MediaDashboard.css` (remove `.pilpod-dl-tabs` usage).

- Rename the `activeTab` union to a `view` state: `"media" | "download" | "vault"`
  (unchanged values; clearer name optional).
- **Delete** the `.pilpod-dl-tabs` block from `MediaDashboard` (the whole
  `{(DOWNLOADER_UI_ENABLED || VAULT_UI_ENABLED) && (...tablist...)}`).
- **`BrowserDockBar` new props:**
  `view`, `onSelectView(view)`, `downloaderEnabled`, `vaultEnabled`, plus the
  existing `browsers`, `activeBrowserId`, `onActiveBrowserChange`.
- **Layout** (`.pilpod-browser-dock`): a flex row —
  `[ browser group ] [ flex spacer ] [ Download btn ] [ Vault btn ]`.
  - Browser group = existing horizontal scroller when `view === "media"`.
  - When `view !== "media"`: render the group as a single
    `.pilpod-browser-dock__stack` button — the same favicons rendered overlapping
    (CSS `margin-left: -10px` on all but the first, subtle ring) — `onClick →
    onSelectView("media")`, `title="Back to browsers"`.
  - Download / Vault buttons: `.pilpod-browser-dock__view-btn`, icon-only,
    `aria-pressed={view === "download"|"vault"}`, active styling reuses the
    `--active` treatment. Gated by `downloaderEnabled` / `vaultEnabled`.
- The dock must now render even with zero open browsers (so Download/Vault stay
  reachable). Change the early `return null`: render the nav always when any of
  {browsers, downloaderEnabled, vaultEnabled}; show the browser group only when
  `openBrowsers.length > 0`.
- **New icons** in `shared/ui/icons.tsx`: `IconDownloadTray` (down-arrow into
  tray) for the dock; reuse `IconBookmark` for the Vault dock button (or add
  `IconVault`). Keep the existing stroke conventions.
- `MediaDashboard` passes `view` / `setView` into `BrowserDockBar` and keeps
  rendering the correct panel in `<main>` exactly as today.

**Done when:** the top tablist is gone; Download/Vault are reachable from the
dock far-right; switching to Download/Vault collapses the browser icons into one
stacked button that returns to Media on click; at 350 px nothing overflows.

## 4. Phase B — In-tab bookmark & download buttons

Reuse the existing `SaveTabButton` (vault) and add a new `TabDownloadButton`.
Thread them into the two row components via optional "accessory" render slots so
existing call sites are unaffected.

**New component** `features/downloader/components/TabDownloadButton.tsx`:
- Props: `status: "idle" | "active" | "done" | "error"`, `onClick`.
- Icon states: idle = `IconDownloadTray`; active = `Spinner` (or a small ring
  with percent tooltip); done = check/filled; error = alert. Tooltip per state.

**Status derivation** (helper in `downloader/lib.ts`):
`downloadStatusForUrl(tasks, url)` → matches a task whose `url` normalizes
(reuse `vault/lib/normalizeUrl`) to the tab URL; maps task kind → button status
(`queued|downloading|muxing → active`, `done → done`, `error → error`, none →
`idle`). Newest task wins.

**Wiring (accessory slots):**
- `MediaItemCard`: add optional props `saveButton?: ReactNode`,
  `downloadButton?: ReactNode`. Render them in `row1-actions`, **right of the
  PiP button** — actually PiP is in `row2` transport; per the request place both
  in `row2` transport, immediately right of the PiP button (or in `row1-actions`
  before reload if row2 is too tight at 350 px — pick during build, keep to one).
- `UnifiedTabRow`: add optional prop `saveButton?: ReactNode`, rendered in
  `pilpod-control-card__actions` **immediately left of the reload button**.
- `BrowserSessionsPanel`: add one prop
  `renderTabAccessories?(tab, browserId, browserDisplayName, isMediaTab): { save?: ReactNode; download?: ReactNode }`
  and call it inside `BrowserBody.renderTabRow`, passing results into the two row
  components. Thread the prop from `MediaDashboard` → `BrowserSessionsPanel`
  (it's already rendered there). No other layers change (renderTabRow is local
  to `BrowserBody`).
- `MediaDashboard` supplies `renderTabAccessories`:
  - `save` = `<SaveTabButton saved={vault.savedUrlSet.has(normalizeUrl(tab.url))}
    onToggle={() => vault.toggleBookmark(captureBookmark(tab, browser))} />`
    (needs the browser for provenance — look up via `browsers` by id).
  - `download` (media tabs only) = `<TabDownloadButton
    status={downloadStatusForUrl(dl.tasks, tab.url)}
    onClick={() => { setDownloadSeed(tab.url); setView("download"); }} />`.

**Done when:** every media card shows a bookmark + download control (right of
PiP); every normal row shows a bookmark control (left of reload); bookmark
toggles fill/unfill live; the download button reflects idle/active/done and
clicking it opens the Download panel prefilled and fetching.

## 5. Phase C — Floating download card

**New component** `features/downloader/components/DownloadDockCard.tsx` + `.css`
(mirror `.pilpod-media-item--float` glass look; add its selectors to
`shared/ui/glass-appearance.css` for the low-glass opaque fallback).

- Input: `tasks` (from lifted `dl`), `onCancel`, `onRetry`, `onOpenFolder`,
  `onClear`.
- Visibility: render **nothing** when `tasks.length === 0`.
- Order: terminal first (`done`/`error`) then active, matching the request
  ("done or error in the top"); within groups, newest-first. (Reuse/extend
  `sortTasks` in `downloader/lib.ts` with this ordering.)
- Expanded: a compact row per task — thumb, title, `statusLabel`, a thin
  progress bar with `percent`, and a small action (Cancel / Retry / Folder),
  reusing `DownloadCard`'s markup at a smaller scale or a new slim row.
- Collapsed: single summary line — `⤓ N done · M active` (+ chevron). Persist
  collapsed state in component state (session-only; no storage).
- Placement: rendered by `MediaDashboard` **inside `<main>`, only when
  `view === "media"`**, **above** `BrowserSessionsPanel` (which starts with the
  active-media strip). This puts it "above the played media at the top" without
  editing `BrowserSessionsPanel`.

**Done when:** starting a download makes the float card appear above the media
strip with a live progress bar; finished/errored items sort to the top;
collapsing shows the count; clearing/emptying the queue hides the card.

## 6. Touch list

Frontend only (no Rust expected):
- `features/media-dashboard/MediaDashboard.tsx` — lift `useDownloader`, `view`
  state, `downloadSeed`, remove tablist, render `DownloadDockCard`, pass dock
  props + `renderTabAccessories`.
- `features/media-dashboard/MediaDashboard.css` — drop dead `.pilpod-dl-tabs`
  rules if unused elsewhere.
- `features/media-dashboard/components/BrowserDockBar.tsx` + `.css` — view
  buttons, collapsed stack.
- `features/media-dashboard/components/BrowserSessionsPanel.tsx` — one accessory
  prop threaded into `renderTabRow`.
- `features/media-dashboard/components/MediaItemCard.tsx` — accessory slots.
- `features/media-dashboard/components/UnifiedTabRow.tsx` — save slot.
- `features/downloader/DownloadPanel.tsx` — accept `dl` + `seedUrl` props
  instead of self-mounting the hook.
- `features/downloader/hooks/useDownloader.ts` — export `DownloaderApi` type.
- `features/downloader/lib.ts` — `downloadStatusForUrl`, terminal-first sort.
- `features/downloader/components/TabDownloadButton.tsx` (new).
- `features/downloader/components/DownloadDockCard.tsx` + `.css` (new).
- `shared/ui/icons.tsx` — `IconDownloadTray` (+ maybe `IconVault`).
- `shared/ui/glass-appearance.css` — register new float surfaces.

## 7. Testing

- **Vitest (logic):** `downloadStatusForUrl` mapping (idle/active/done/error,
  URL-normalization match); terminal-first sort ordering. Colocate under
  `downloader/lib.test.ts` (existing file).
- **Type check:** `npx tsc --noEmit` clean.
- **Manual smoke:** dock switching + collapsed stack return; bookmark toggle on
  both row types; download button opens prefilled panel and reflects status;
  float card appears/sorts/collapses/hides; 350 px layout in light/dark and
  across glass strengths.
- Reuse the read-only test-agent brief pattern for the final pass.

## 8. Risks & notes

- **Deep-ish threading** into `BrowserSessionsPanel`/row components — mitigated
  by making every new prop optional (default = render nothing), so existing
  behavior is unchanged if a slot isn't provided.
- **Two download surfaces** (float card on Media + full panel on Download) share
  one lifted hook — verify no duplicate event listeners after the lift.
- **Premium:** the float card and tab download button are intentionally visible
  to free users; the actual gate stays at the Download panel. No entitlement
  checks added to the new UI.
- **Row density at 350 px:** media `row2` may be tight with two extra buttons;
  fall back to placing save/download in `row1-actions` if needed (decide during
  build, keep consistent).
```
