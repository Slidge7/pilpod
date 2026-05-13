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
  if (!msg || msg.type !== "OMNI_MEDIA_CONTROL") return;
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
  };
}

function tick() {
  try {
    chrome.runtime.sendMessage({
      type: "OMNI_MEDIA_SNAPSHOT",
      payload: snapshot(),
    });
  } catch (_) {}
}

setInterval(tick, 1500);
tick();
