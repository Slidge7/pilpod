function mediaElements() {
  return [
    ...document.querySelectorAll("video"),
    ...document.querySelectorAll("audio"),
  ];
}

function dispatchMediaKey(key) {
  const opts = { key, code: key, bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent("keydown", opts));
  document.dispatchEvent(new KeyboardEvent("keyup", opts));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "PILPOD_MEDIA_CONTROL") return;
  const action = String(msg.action || "");
  if (action === "playPause") {
    const els = mediaElements();
    const el = els[0];
    if (el) {
      if (el.paused) void el.play().catch(() => {});
      else el.pause();
    }
    sendResponse({ ok: true });
    return;
  }
  if (action === "next") {
    dispatchMediaKey("MediaTrackNext");
    sendResponse({ ok: true });
    return;
  }
  if (action === "previous") {
    dispatchMediaKey("MediaTrackPrevious");
    sendResponse({ ok: true });
  }
});

function pickArtworkUrl() {
  const m = navigator.mediaSession && navigator.mediaSession.metadata;
  if (m && m.artwork && m.artwork.length) {
    let bestSrc = "";
    let bestW = 0;
    for (const a of m.artwork) {
      if (!a || !a.src) continue;
      const src = String(a.src);
      const raw = a.sizes ? String(a.sizes) : "";
      const w = parseInt(raw.split(/[x×]/)[0], 10) || 0;
      if (w >= bestW || !bestSrc) {
        bestW = w;
        bestSrc = src;
      }
    }
    if (bestSrc) return bestSrc;
  }
  const v = document.querySelector("video");
  if (v && v.poster) return String(v.poster);
  return "";
}

function playbackState() {
  const medias = mediaElements();
  const playing = medias.some(
    (el) => !el.paused && !el.ended && el.readyState > 2,
  );
  if (playing) return "playing";
  const paused = medias.some((el) => el.readyState > 0 && el.paused);
  if (paused) return "paused";
  return "none";
}

function snapshot() {
  const m = navigator.mediaSession && navigator.mediaSession.metadata;
  return {
    title: (m && m.title) || document.title || "",
    artist: (m && m.artist) || "",
    album: (m && m.album) || "",
    url: location.href,
    playbackState: playbackState(),
    artworkUrl: pickArtworkUrl(),
  };
}

function tick() {
  try {
    chrome.runtime.sendMessage({
      type: "PILPOD_MEDIA_SNAPSHOT",
      payload: snapshot(),
    });
  } catch (_) {}
}

setInterval(tick, 800);
tick();
