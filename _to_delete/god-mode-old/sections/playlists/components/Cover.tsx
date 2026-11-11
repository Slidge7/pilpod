import { memo, type CSSProperties } from "react";
import { hueFor } from "../../../ui/hue";
import { Thumb } from "../../../ui/Thumb";

/**
 * A playlist's cover: four artworks as a mosaic, one as a full cover, or —
 * with none — a tile coloured by the playlist's name with its emoji.
 */
function CoverView({
  artworks,
  name,
  emoji,
  size = "md",
}: {
  artworks: readonly string[];
  name: string;
  emoji?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const glyph = emoji || name.trim().charAt(0).toUpperCase() || "♪";
  if (artworks.length >= 4) {
    return (
      <span className={`gm-cover gm-cover--${size} gm-cover--mosaic`} aria-hidden="true">
        {artworks.slice(0, 4).map((src) => (
          <Thumb key={src} src={src} glyph={glyph} hueKey={name} kind="art" />
        ))}
      </span>
    );
  }
  if (artworks.length > 0) {
    return (
      <span className={`gm-cover gm-cover--${size}`} aria-hidden="true">
        <Thumb src={artworks[0]} glyph={glyph} hueKey={name} kind="art" />
      </span>
    );
  }
  const style = { "--gm-tile-hue": hueFor(name) } as CSSProperties;
  return (
    <span className={`gm-cover gm-cover--${size} gm-cover--blank`} style={style} aria-hidden="true">
      <span className="gm-cover__glyph">{glyph}</span>
    </span>
  );
}

export const Cover = memo(CoverView);
