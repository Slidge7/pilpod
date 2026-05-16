import type { BrowserTabMediaDto } from "../../../types/media";
import { browserGroupLabel, browserRowKey } from "../lib/browserMedia";
import { BrowserTabRow } from "./BrowserTabRow";

type Props = {
  groups: readonly (readonly [string, BrowserTabMediaDto[]])[];
  pendingKeys: ReadonlySet<string>;
  onPlayPauseBrowser: (t: BrowserTabMediaDto) => void;
  onFocusBrowserTab: (t: BrowserTabMediaDto) => void;
};

export function BrowserSessionsPanel({
  groups,
  pendingKeys,
  onPlayPauseBrowser,
  onFocusBrowserTab,
}: Props) {
  return (
    <section role="tabpanel" id="panel-browser" aria-labelledby="tab-browser">
      {groups.length === 0 ? (
        <p className="py-8 text-center text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">
          No browser tabs. Install the companion extension and play media in
          Chromium.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(([browserId, tabs]) => (
            <div
              key={browserId}
              className="overflow-hidden rounded-sm border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950/50"
            >
              <header className="border-b border-zinc-300 bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500">
                {browserGroupLabel(browserId, tabs)}
              </header>
              <ul className="m-0 list-none divide-y divide-zinc-200 p-0 dark:divide-zinc-800">
                {tabs.map((t) => {
                  const rk = browserRowKey(t);
                  return (
                    <BrowserTabRow
                      key={rk}
                      tab={t}
                      busy={pendingKeys.has(rk)}
                      onPlayPause={onPlayPauseBrowser}
                      onFocusTab={onFocusBrowserTab}
                    />
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
