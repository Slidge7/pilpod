import { IconBlock } from "../../shared/ui/icons";
import { youtubeBlockApi } from "./api";
import { isBlockableUrl } from "./lib/videoId";

type Props = {
  url: string;
  /** The video's title (media title, else the tab title). */
  title?: string | null;
  browserName?: string | null;
  /** Host surface's own icon-button class, so it blends in. */
  className: string;
};

/**
 * "Block this video" — renders only for YouTube video URLs. Pressing it saves
 * the video's title and link; Rust then skips it whenever it plays in a tab
 * the user is not looking at.
 */
export function BlockVideoButton({ url, title, browserName, className }: Props) {
  if (!isBlockableUrl(url)) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        void youtubeBlockApi
          .add({ url, title, browserName })
          .catch((err: unknown) => console.error("[youtube-block] block video:", err));
      }}
      title="Block this video — it is skipped whenever it plays out of focus"
      aria-label="Block this video"
    >
      <IconBlock />
    </button>
  );
}
