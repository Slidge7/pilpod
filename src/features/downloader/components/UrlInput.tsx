import { useState } from "react";

type Props = {
  fetching: boolean;
  onFetch: (url: string) => void;
};

export function UrlInput({ fetching, onFetch }: Props) {
  const [url, setUrl] = useState("");
  const valid = /^https?:\/\/\S+$/i.test(url.trim());

  return (
    <form
      className="pilpod-dl-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !fetching) onFetch(url.trim());
      }}
    >
      <input
        className="pilpod-dl-input"
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste a video or audio link…"
        spellCheck={false}
        autoComplete="off"
        aria-label="Media URL"
      />
      <button
        type="submit"
        className="pilpod-dl-btn pilpod-dl-btn--primary"
        disabled={!valid || fetching}
      >
        {fetching ? "Loading…" : "Fetch"}
      </button>
    </form>
  );
}
