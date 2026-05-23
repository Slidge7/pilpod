import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "../../../shared/ui/icons";

type Props = {
  loading: boolean;
  onFetch: (url: string) => void;
  prefillUrl?: string | null;
};

export function UrlInput({ loading, onFetch, prefillUrl }: Props) {
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prefillUrl) setUrl(prefillUrl);
  }, [prefillUrl]);

  const handleSubmit = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed || loading) return;
    onFetch(trimmed);
  }, [url, loading, onFetch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSubmit();
    },
    [handleSubmit],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData("text").trim();
      if (text) {
        setUrl(text);
        // Auto-trigger fetch on paste of a URL.
        if (text.startsWith("http://") || text.startsWith("https://")) {
          setTimeout(() => onFetch(text), 0);
        }
      }
    },
    [onFetch],
  );

  return (
    <div className="pilpod-dl-url">
      <input
        ref={inputRef}
        type="url"
        className="pilpod-dl-url__input"
        placeholder="Paste a URL (YouTube, TikTok, …)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        disabled={loading}
        aria-label="Video URL"
      />
      <button
        className="pilpod-dl-url__btn"
        disabled={!url.trim() || loading}
        onClick={handleSubmit}
        aria-label="Fetch video info"
      >
        {loading ? <Spinner /> : "Fetch"}
      </button>
    </div>
  );
}
