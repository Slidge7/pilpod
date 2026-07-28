/* PilPod in-app player agent.
 *
 * Injected (via `initialization_script`) into every document the player window
 * loads, before the site's own scripts. It plays the role the companion
 * extension's content script plays in a real browser:
 *
 *   1. cinema layout — the media element fills the window, nothing else shows
 *   2. reporting     — media state, in the same shape the extension reports
 *   3. commands      — executes the shared `action` enum pushed from Rust
 *   4. window chrome — drag strip + close button (the window has no decorations)
 *
 * Sequencing (next/previous/repeat/shuffle) is NOT handled here: PilPod owns
 * the playlist, exactly as it does on the browser path.
 *
 * Config is injected ahead of this file as `window.__PILPOD_CFG`:
 *   { ep: "<ipc endpoint url>", css: "<cinema.css>" }
 */
(function () {
  'use strict';

  // Top frame only — ads and embeds must never report or restyle.
  if (window.top !== window.self) return;
  if (window.__pilpod) return;

  /**
   * The stage webview also hosts PilPod's OWN stage page (YouTube plays through
   * the IFrame API there). That page reports and controls itself over IPC, so
   * the agent must keep its hands off it: no cinema layout, no pointer lock, no
   * reports. `main.tsx` sets the flag while the module graph evaluates, which
   * is before `DOMContentLoaded` — i.e. before anything below acts.
   */
  function ownPage() {
    return !!window.__PILPOD_STAGE_APP;
  }

  var CFG = window.__PILPOD_CFG || {};
  var EP = CFG.ep || '';
  var ADAPTERS = window.__PILPOD_ADAPTERS || { find: function () { return null; } };
  var adapter = null;

  // Every message costs a cancelled navigation, which the page notices, so
  // progress runs at 1 Hz and the UI interpolates between ticks. State changes
  // (play/pause/track/metadata/ended) are always sent immediately.
  var PROGRESS_MS = 1000;
  var SEND_GAP_MS = 60;    // one navigation-channel message per tick, at most

  // ── channel: page → Rust ────────────────────────────────────────────────
  // A cancelled top-level navigation to a reserved (.invalid) host. Chromium
  // does not apply CSP to navigations, so this works on sites whose
  // connect-src would block a socket or fetch. Rust cancels it in
  // `on_navigation`, so the page never unloads.
  var outbox = [];
  var timer = null;
  var lastSend = 0;

  function send(msg) {
    // Progress is lossy: a queued progress frame is replaced, never stacked.
    if (msg.k === 'p') {
      for (var i = 0; i < outbox.length; i++) {
        if (outbox[i].k === 'p') { outbox[i] = msg; drain(); return; }
      }
    }
    outbox.push(msg);
    drain();
  }

  function drain() {
    if (timer || !outbox.length) return;
    var wait = Math.max(0, SEND_GAP_MS - (Date.now() - lastSend));
    timer = setTimeout(function () {
      timer = null;
      var msg = outbox.shift();
      if (msg) {
        lastSend = Date.now();
        try {
          window.location.href = EP + '?d=' + encodeURIComponent(JSON.stringify(msg));
        } catch (e) { /* never let reporting break playback */ }
      }
      if (outbox.length) drain();
    }, wait);
  }

  // ── media element discovery ─────────────────────────────────────────────
  var el = null;          // current media element
  var bound = null;       // element we attached listeners to

  function score(v) {
    var a = (v.videoWidth || v.clientWidth || 1) * (v.videoHeight || v.clientHeight || 1);
    // A element that actually has media beats a bigger empty one.
    if (v.duration > 0 || v.currentTime > 0 || !v.paused) a += 1e9;
    if (v.readyState > 0) a += 1e6;
    return a;
  }

  function pick() {
    var best = null, bestScore = -1;
    var vids = document.getElementsByTagName('video');
    for (var i = 0; i < vids.length; i++) {
      var s = score(vids[i]);
      if (s > bestScore) { bestScore = s; best = vids[i]; }
    }
    if (best) return best;
    var auds = document.getElementsByTagName('audio');
    return auds.length ? auds[0] : null;
  }

  // ── cinema layout ───────────────────────────────────────────────────────
  //
  // This runs before the document exists (`initialization_script`), so every
  // DOM touch has to tolerate a null `documentElement` and retry.
  function ensureStyle() {
    var root = document.head || document.documentElement;
    if (!root) {
      // Document not built yet — try again on the next tick.
      setTimeout(ensureStyle, 0);
      return;
    }
    var s = document.getElementById('pilpod-cinema-style');
    if (s && s.isConnected) return;
    s = document.createElement('style');
    s.id = 'pilpod-cinema-style';
    s.textContent = CFG.css || '';
    root.appendChild(s);
    markCinema();
  }

  function markCinema() {
    if (document.documentElement) {
      document.documentElement.classList.add('pilpod-cinema');
    }
  }

  // ── loading feedback ────────────────────────────────────────────────────
  // The stage is black until the site's player paints; without this the window
  // just looks broken.
  function ensureLoader() {
    if (!document.documentElement) return;
    var el0 = document.getElementById('pilpod-loading');
    if (el0 && el0.isConnected) return;
    var box = document.createElement('div');
    box.id = 'pilpod-loading';
    box.innerHTML = '<div id="pilpod-spinner"></div>';
    document.documentElement.appendChild(box);
  }

  function clearLoader() {
    var box = document.getElementById('pilpod-loading');
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

  function isolate(node) {
    document.documentElement.classList.add('pilpod-cinema');
    // Lock interaction only now that there is something to show — see
    // `.pilpod-locked` in cinema.css.
    document.documentElement.classList.add('pilpod-locked');
    node.classList.add('pilpod-stage');
    var n = node;
    var guard = 0;
    while (n && n.parentElement && guard++ < 64) {
      var parent = n.parentElement;
      var kids = parent.children;
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (kid === n || kid.id === 'pilpod-loading' || kid.tagName === 'STYLE') continue;
        if (kid.classList.contains('pilpod-hidden')) continue;
        kid.classList.add('pilpod-hidden');
      }
      if (parent !== document.body && parent !== document.documentElement) {
        parent.classList.add('pilpod-chain');
      }
      n = parent;
    }
  }

  function applyAdapter(node) {
    if (!adapter) return;
    var sel, list, i, j;
    if (adapter.hide) {
      for (i = 0; i < adapter.hide.length; i++) {
        try { list = document.querySelectorAll(adapter.hide[i]); } catch (e) { continue; }
        for (j = 0; j < list.length; j++) {
          // Never hide something that contains the video.
          if (node && list[j].contains(node)) continue;
          list[j].classList.add('pilpod-hidden');
        }
      }
    }
    if (adapter.click) {
      for (i = 0; i < adapter.click.length; i++) {
        try { sel = document.querySelector(adapter.click[i]); } catch (e) { continue; }
        if (sel && sel.offsetParent !== null) { try { sel.click(); } catch (e) {} }
      }
    }
  }

  // Window chrome (drag strip, close button, transport) lives in the sibling
  // `player-ui` webview, which is a real React surface with real IPC. Nothing
  // of PilPod's own UI is injected into the site's page any more.

  // ── reporting ───────────────────────────────────────────────────────────
  function metaOf() {
    var out = { title: '', artist: '', album: '', art: '' };
    try {
      var m = navigator.mediaSession && navigator.mediaSession.metadata;
      if (m) {
        out.title = m.title || '';
        out.artist = m.artist || '';
        out.album = m.album || '';
        if (m.artwork && m.artwork.length) {
          out.art = m.artwork[m.artwork.length - 1].src || '';
        }
      }
    } catch (e) {}
    if (!out.title) {
      var og = document.querySelector('meta[property="og:title"]');
      out.title = (og && og.content) || document.title || '';
    }
    if (!out.art) {
      var oi = document.querySelector('meta[property="og:image"]');
      if (oi && oi.content) out.art = oi.content;
    }
    return out;
  }

  function stateOf() {
    var m = metaOf();
    var playing = !!(el && !el.paused && !el.ended && el.readyState > 2);
    return {
      k: 's',
      u: location.href,
      t: document.title || '',
      st: !el ? 'none' : (playing ? 'playing' : 'paused'),
      mt: m.title,
      ar: m.artist,
      al: m.album,
      aw: m.art,
      d: el && isFinite(el.duration) ? el.duration : 0,
      ct: el ? el.currentTime : 0,
      v: el ? Math.round(el.volume * 100) : 100,
      mu: el ? !!el.muted : false,
      cs: !!(el && isFinite(el.duration) && el.duration > 0),
      cp: false, // requestPictureInPicture needs a real gesture — Phase 3
      pip: !!(document.pictureInPictureElement),
      hm: !!el,
    };
  }

  var lastProgress = 0;
  function reportState() { send(stateOf()); }
  function reportProgress(force) {
    if (!el) return;
    var now = Date.now();
    if (!force && now - lastProgress < PROGRESS_MS) return;
    lastProgress = now;
    send({
      k: 'p',
      ct: el.currentTime,
      d: isFinite(el.duration) ? el.duration : 0,
      st: (!el.paused && !el.ended) ? 1 : 0,
    });
  }

  // Sites mute themselves to get past autoplay policies (YouTube does this
  // routinely). PilPod's window exists to play sound, so the agent undoes that
  // — unless the user muted deliberately through PilPod's own control.
  var userMuted = false;
  function unmuteUnlessAsked(node) {
    if (!node || userMuted || !node.muted) return;
    try {
      node.muted = false;
      if (node.volume === 0) node.volume = 1;
    } catch (e) {}
  }

  function bind(node) {
    if (bound === node) return;
    bound = node;
    if (!node) return;
    var restate = function () { reportState(); };
    node.addEventListener('play', restate);
    node.addEventListener('pause', restate);
    node.addEventListener('loadedmetadata', function () {
      unmuteUnlessAsked(node);
      reportState();
      // Autoplay: the window is launched with
      // --autoplay-policy=no-user-gesture-required, so this succeeds without a
      // gesture. Failure is non-fatal — the user can press play.
      if (node.paused) { try { node.play().catch(function () {}); } catch (e) {} }
    });
    node.addEventListener('volumechange', restate);
    // Duration arrives late on streaming sites, and it is what makes the seek
    // bar usable — report the moment it is known.
    node.addEventListener('durationchange', restate);
    node.addEventListener('canplay', function () {
      unmuteUnlessAsked(node);
      restate();
    });
    node.addEventListener('enterpictureinpicture', restate);
    node.addEventListener('leavepictureinpicture', restate);
    node.addEventListener('timeupdate', function () { reportProgress(false); });
    node.addEventListener('ended', function () {
      reportState();
      send({ k: 'e' });    // PilPod advances the playlist — never the site
    });
    node.addEventListener('error', function () { send({ k: 'r', m: 'media_error' }); });
  }

  // ── commands: Rust → page ───────────────────────────────────────────────

  /** The media element, resolved lazily: a command must never no-op just
   *  because the observer has not caught up with the page yet. */
  function stage() {
    if (!el || !el.isConnected) {
      var found = pick();
      if (found) { el = found; bind(el); }
    }
    return el;
  }

  window.__pilpod = {
    cmd: function (c) {
      try {
        if (!c) return;
        var v = typeof c.value === 'number' ? c.value : null;
        el = stage();
        switch (c.action) {
          case 'playPause':
            if (!el) return;
            if (el.paused) { el.play().catch(function () {}); } else { el.pause(); }
            break;
          case 'seek':
            if (el && v !== null && isFinite(el.duration)) {
              el.currentTime = Math.max(0, Math.min(v, el.duration));
              reportProgress(true);
            }
            break;
          case 'setTabVolume':
            // 0–600 in PilPod units; the element itself caps at 100 (a
            // GainNode lifts the ceiling in Phase 3).
            if (el && v !== null) {
              el.volume = Math.max(0, Math.min(1, v / 100));
              if (v > 0 && el.muted) el.muted = false;
            }
            break;
          case 'muteTab':
            if (el) {
              el.muted = v === null ? !el.muted : v >= 1;
              // Remember the user's intent so the auto-unmute above does not
              // fight it on the next track.
              userMuted = el.muted;
            }
            break;
          case 'pip':
            if (el && el.requestPictureInPicture) {
              if (document.pictureInPictureElement) {
                document.exitPictureInPicture().catch(function () {});
              } else {
                el.requestPictureInPicture().catch(function () {});
              }
            }
            break;
          case 'reloadTab':
            location.reload();
            return;
          default:
            return;
        }
        reportState();
      } catch (e) { /* a bad command must never break the page */ }
    },
    /** Rust asks for a fresh snapshot (e.g. after the UI reconnects). */
    sync: function () { refresh(); reportState(); },
  };

  // ── main loop ───────────────────────────────────────────────────────────
  var scheduled = false;
  function refresh() {
    if (scheduled || ownPage()) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      if (!document.documentElement || ownPage()) return;
      ensureStyle();
      var found = pick();
      if (found && found !== el) {
        el = found;
        bind(el);
        reportState();
      }
      if (el) {
        if (!el.classList.contains('pilpod-stage') || !document.documentElement.classList.contains('pilpod-cinema')) {
          isolate(el);
        }
        // Media found and running ⇒ the stage is no longer "loading".
        if (el.readyState > 2) clearLoader();
        else ensureLoader();
      } else {
        ensureLoader();
      }
      applyAdapter(el);
    });
  }

  function boot() {
    if (ownPage()) return;
    adapter = ADAPTERS.find(location.hostname);
    ensureStyle();
    ensureLoader();
    refresh();
    reportState();

    var mo = new MutationObserver(refresh);
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Cheap safety net for sites that swap media without touching the DOM.
    setInterval(function () {
      var found = pick();
      if (found !== el) refresh();
      else if (el && !el.paused) reportProgress(false);
    }, 1000);

    // A page that never produces a media element is a dead end (an embed the
    // uploader blocked, a consent wall, a login page). Say so once so the app
    // can fall back instead of spinning forever.
    setTimeout(function () {
      if (!el) send({ k: 'r', m: 'no_media' });
    }, 8000);

    window.addEventListener('pagehide', function () { send({ k: 'r', m: 'unload' }); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
    // The page can take seconds; claim the surface immediately so the user
    // never sees the site's chrome flash. Both calls tolerate a document that
    // does not exist yet and retry themselves.
    ensureStyle();
    markCinema();
  } else {
    boot();
  }
})();
