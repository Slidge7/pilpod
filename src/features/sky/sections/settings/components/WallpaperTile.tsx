import { memo, useEffect, useRef, useState } from "react";
import type { AppearanceMode } from "../../../../../theme/appearance";
import { prettyWallpaperName, type WallpaperSource } from "../../../../media-dashboard";
import { IconCheck } from "../../../../../shared/ui/icons";
import { wallpaperThumb } from "../lib/wallpaperThumbs";

/**
 * The preview of one wallpaper, loaded only once it scrolls near the view —
 * a custom folder can hold hundreds of photos.
 */
export function useWallpaperPreview(
  source: WallpaperSource,
  name: string | null,
  mode: AppearanceMode,
  eager = false,
) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(eager);
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);
  const key = name ? `${source}:${mode}:${name}` : "";

  useEffect(() => {
    if (visible || eager) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, eager]);

  useEffect(() => {
    if (!name || !(visible || eager)) return;
    let alive = true;
    void wallpaperThumb(source, name, mode).then((url) => {
      if (alive) setLoaded({ key, url });
    });
    return () => {
      alive = false;
    };
  }, [source, name, mode, visible, eager, key]);

  const ready = loaded?.key === key;
  return { ref, url: ready ? loaded.url : null, loading: Boolean(name) && !ready };
}

type Props = {
  source: WallpaperSource;
  name: string;
  mode: AppearanceMode;
  selected: boolean;
  onSelect: (name: string) => void;
};

function WallpaperTileView({ source, name, mode, selected, onSelect }: Props) {
  const preview = useWallpaperPreview(source, name, mode);
  const label = prettyWallpaperName(name);
  return (
    <li>
      <button
        ref={(el) => {
          preview.ref.current = el;
        }}
        type="button"
        className={`sky-wp-tile${selected ? " is-selected" : ""}`}
        aria-pressed={selected}
        title={name}
        onClick={() => onSelect(name)}
      >
        <span className={`sky-wp-tile__img${preview.loading ? " is-loading" : ""}`}>
          {preview.url ? <img src={preview.url} alt="" draggable={false} decoding="async" /> : null}
          {selected ? (
            <span className="sky-wp-tile__check" aria-hidden="true">
              <IconCheck />
            </span>
          ) : null}
        </span>
        <span className="sky-wp-tile__name">{label}</span>
      </button>
    </li>
  );
}

export const WallpaperTile = memo(WallpaperTileView);
