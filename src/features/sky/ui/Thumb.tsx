import { memo, useState, type CSSProperties } from "react";
import { hueFor } from "./hue";

type Props = {
  src: string | null | undefined;
  /** Shown on a coloured tile when there is no image or it fails to load. */
  glyph: string;
  /** Picks the tile colour; defaults to the glyph. */
  hueKey?: string;
  /** `icon`: a favicon centred on a tile. `art`: artwork filling the frame. */
  kind?: "icon" | "art";
  className?: string;
};

/**
 * The picture beside any result or row. Never shows a broken image: a failed
 * load falls back to a per-name tile, and a new `src` gets a fresh attempt.
 */
function ThumbView({ src, glyph, hueKey, kind = "icon", className }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const usable = src && src !== failedSrc && !src.startsWith("chrome://") ? src : null;
  const style = { "--sky-tile-hue": hueFor(hueKey ?? glyph) } as CSSProperties;
  const classes = ["sky-thumb2", `sky-thumb2--${kind}`, usable ? "" : "sky-thumb2--tile", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} style={style} aria-hidden="true">
      {usable ? (
        <img
          src={usable}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(usable)}
        />
      ) : (
        <span className="sky-thumb2__glyph">{glyph}</span>
      )}
    </span>
  );
}

export const Thumb = memo(ThumbView);
