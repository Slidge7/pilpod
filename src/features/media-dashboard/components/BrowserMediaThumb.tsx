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
      <div className="flex h-full w-full items-center justify-center bg-zinc-200 text-[11px] font-semibold uppercase text-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
        {letter}
      </div>
    );
  }

  const src = mode === "art" ? art : fav!;

  return (
    <img
      src={src}
      alt=""
      className="h-full w-full object-cover"
      onError={() =>
        setMode((m) => (m === "art" && fav ? "fav" : "letter"))
      }
    />
  );
}
