import "./BrowserMediaThumb.css";
import { useEffect, useState } from "react";
import type { BrowserTabMediaDto } from "../../../types/media";
import { faviconFromUrl } from "../lib/browserMedia";

type Props = { tab: BrowserTabMediaDto };

export function BrowserMediaThumb({ tab }: Props) {
  const art = tab.artworkUrl?.trim() ?? "";
  const fav = faviconFromUrl(tab.url);
  const letter = (tab.title?.trim() || "?").slice(0, 1).toUpperCase();

  const [mode, setMode] = useState<"art" | "fav" | "letter">("letter");

  useEffect(() => {
    if (art) setMode("art");
    else if (fav) setMode("fav");
    else setMode("letter");
  }, [art, fav]);

  if (mode === "letter") {
    return (
      <div className="pilpod-browser-thumb-letter">{letter}</div>
    );
  }

  const src = mode === "art" ? art : fav!;

  return (
    <img
      src={src}
      alt=""
      className="pilpod-browser-thumb-img"
      onError={() =>
        setMode((m) => (m === "art" && fav ? "fav" : "letter"))
      }
    />
  );
}
