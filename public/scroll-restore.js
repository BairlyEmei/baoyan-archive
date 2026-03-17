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
 *     absence of the `astro:navigated` session-flag set below.
 *   - On scroll: debounce-save the current position to localStorage.
 *   - On pagehide: eagerly save the current position.
 */
(function () {
  var PREFIX = 'scrollpos:';
  var SAVE_DELAY = 250;
  var saveTimer = null;

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
    window.addEventListener('scroll', scheduleSave, { passive: true });
  }

  // --- Initial (hard) page load ---
  // sessionStorage flag is absent on a fresh browser load but present after
  // any Astro client-side navigation within the same session.
  var freshLoad = !sessionStorage.getItem('astro:navigated');

  document.addEventListener('DOMContentLoaded', function () {
    if (freshLoad) {
      restore();
    }
    attachScrollListener();
  });

  // --- Astro View Transitions ---
  // astro:page-load fires after every client-side navigation.
  // We re-attach the scroll listener for the new page and set the
  // session flag so the *next* astro:page-load knows not to restore.
  document.addEventListener('astro:page-load', function () {
    // On a fresh load DOMContentLoaded already ran; skip re-attachment to
    // avoid duplicate listeners.
    if (!freshLoad) {
      attachScrollListener();
    }
    freshLoad = false;
    try {
      sessionStorage.setItem('astro:navigated', '1');
    } catch (_) {}
  });

  // Save eagerly when the user leaves the page.
  window.addEventListener('pagehide', save);
})();
