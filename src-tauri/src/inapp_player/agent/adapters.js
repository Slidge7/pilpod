/* PilPod in-app player — per-host adapters.
 *
 * Data, not code: a flat table of host suffixes. The agent works without any
 * entry here (generic path), so adding a site later is a table edit.
 *
 *   hide     : selectors force-hidden on every pass (overlays the generic
 *              isolation cannot reach, e.g. fixed-position banners)
 *   click    : selectors clicked when present (consent, skip-ad)
 *   ready(el): optional hook run once per navigation, after the media element
 *              is found
 *   ua       : optional user-agent override (unused for now; the window UA is
 *              set at creation time)
 */
window.__PILPOD_ADAPTERS = (function () {
  var TABLE = {
    'youtube.com': {
      hide: [
        'ytm-app > *:not(#player-control-overlay)',
        '.ytp-pause-overlay',
        '.ytp-ce-element',
        '.ytp-endscreen-content',
        'ytm-companion-slot',
        'ytm-mealbar-promo-renderer',
        'tp-yt-paper-dialog',
        '#dialog',
      ],
      click: [
        '.ytp-ad-skip-button',
        '.ytp-skip-ad-button',
        '.ytp-ad-skip-button-modern',
        'button[aria-label="Skip Ads"]',
      ],
    },
    'youtu.be': { alias: 'youtube.com' },
    'youtube-nocookie.com': { alias: 'youtube.com' },
    'vimeo.com': {
      hide: ['.vp-outro', '.vp-title', '.vp-share'],
      click: [],
    },
    'soundcloud.com': {
      hide: ['.playControls', '.header'],
      click: [],
    },
    'dailymotion.com': {
      hide: ['.np_DialogContainer'],
      click: ['.video-ad-skip'],
    },
  };

  function resolve(entry, depth) {
    if (!entry) return null;
    if (entry.alias && depth < 3) return resolve(TABLE[entry.alias], depth + 1);
    return entry;
  }

  return {
    /** Adapter for a hostname, or null for the generic path. */
    find: function (host) {
      host = String(host || '').toLowerCase();
      for (var key in TABLE) {
        if (!Object.prototype.hasOwnProperty.call(TABLE, key)) continue;
        if (host === key || host.endsWith('.' + key)) {
          return resolve(TABLE[key], 0);
        }
      }
      return null;
    },
  };
})();
