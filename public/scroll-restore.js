/**
 * scroll-restore.js
 *
 * Saves the user's scroll position for each page to localStorage so that
 * when they return to the same URL (e.g. after closing and reopening the
 * tab) the page is automatically scrolled back to where they left off.
 *
 * Behaviour:
 *   - On DOMContentLoaded (fresh/hard load): restore saved scroll position.
 *   - On Astro View Transition navigation (astro:page-load): do NOT restore
 *     because the user intentionally navigated to a new page and should see
 *     the top.  We only restore on a genuine fresh load, detected by the
 *     absence of the `astro:navigated` sessionStorage flag at the time the
 *     handler runs.
 *   - On scroll: debounce-save the current position to localStorage.
 *   - On pagehide: eagerly save the current position.
 */
(function () {
  var PREFIX = 'scrollpos:';
  var SAVE_DELAY = 250;
  var saveTimer = null;
  var scrollListenerAttached = false;

  function key() {
    return PREFIX + location.pathname;
  }

  function save() {
    try {
      localStorage.setItem(key(), String(window.scrollY));
    } catch (_) {}
  }

  function restore() {
    try {
      var saved = localStorage.getItem(key());
      if (saved) {
        window.scrollTo(0, parseInt(saved, 10) || 0);
      }
    } catch (_) {}
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY);
  }

  function attachScrollListener() {
    if (scrollListenerAttached) return;
    window.addEventListener('scroll', scheduleSave, { passive: true });
    scrollListenerAttached = true;
  }

  function isFreshLoad() {
    // sessionStorage is cleared when the tab/session ends, so its absence
    // reliably identifies a fresh (non-client-side-navigation) page load.
    try {
      return !sessionStorage.getItem('astro:navigated');
    } catch (_) {
      return true;
    }
  }

  function markNavigated() {
    try {
      sessionStorage.setItem('astro:navigated', '1');
    } catch (_) {}
  }

  // --- Initial (hard) page load ---
  document.addEventListener('DOMContentLoaded', function () {
    if (isFreshLoad()) {
      restore();
    }
    attachScrollListener();
  });

  // --- Astro View Transitions ---
  // astro:page-load fires after every client-side navigation AND after the
  // initial page load.  We use it to:
  //   1. Re-attach the scroll listener after each navigation.
  //   2. Mark the session so subsequent page-loads are NOT treated as fresh.
  document.addEventListener('astro:page-load', function () {
    // On the very first (non-client-nav) page-load DOMContentLoaded already
    // attached the listener; attachScrollListener is idempotent so it's safe
    // to call again here.
    attachScrollListener();
    // Mark that any future astro:page-load within this tab is a navigation,
    // not a fresh load.
    markNavigated();
  });

  // Save eagerly when the user leaves the page.
  window.addEventListener('pagehide', save);
})();
