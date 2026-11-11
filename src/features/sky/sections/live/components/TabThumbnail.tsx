import { useMemo, useState, type CSSProperties } from "react";
import type { BrowserTab } from "../../../../../types/media";
import {
  tabIconTile,
  tabThumbnailSources,
  type IconTile,
} from "../lib/thumbnail";

type Props = { tab: BrowserTab };

/**
 * A tab's 16:9 picture. Tries each real image in turn (artwork, then a
 * derived video thumbnail) and settles on a favicon tile when none loads.
 */
export function TabThumbnail({ tab }: Props) {
  const artworkUrl = tab.media?.artworkUrl;
  const sources = useMemo(
    () => tabThumbnailSources(tab),
    // Only the inputs the sources depend on — not the whole, ever-new tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [artworkUrl, tab.url],
  );

  // Which source we are on, remembered *per source list* so a tab that
  // navigates gets a fresh run instead of inheriting the old failures.
  const sourcesKey = sources.join("\n");
  const [attempt, setAttempt] = useState({ key: sourcesKey, index: 0 });
  const index = attempt.key === sourcesKey ? attempt.index : 0;
  const src = sources[index];

  if (src) {
    return (
      <img
        className="sky-thumb sky-thumb--image"
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setAttempt({ key: sourcesKey, index: index + 1 })}
      />
    );
  }

  const tile = tabIconTile(tab);
  // Keyed on the icon so a new favicon gets a fresh load attempt.
  return <IconTileView key={tile.iconUrl ?? ""} tile={tile} />;
}

function IconTileView({ tile }: { tile: IconTile }) {
  const [iconFailed, setIconFailed] = useState(false);
  const style = { "--sky-tile-hue": tile.hue } as CSSProperties;

  return (
    <div className="sky-thumb sky-thumb--tile" style={style} aria-hidden="true">
      {tile.iconUrl && !iconFailed ? (
        <img
          className="sky-thumb__icon"
          src={tile.iconUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setIconFailed(true)}
        />
      ) : (
        <span className="sky-thumb__letter">{tile.letter}</span>
      )}
    </div>
  );
}
