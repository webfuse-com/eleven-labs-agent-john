let isMobile = null;      // current state
let prevIsMobile = null;  // last sent state
let debounceTimer = null;

// Hysteresis: mobile when <= 820px, desktop when >= 900px.
// Anything in between keeps prior state to avoid flip-flop around the threshold.
const MOBILE_MAX = 820;
const DESKTOP_MIN = 900;

function computeIsMobile() {
  // Prefer visualViewport (reflects dynamic browser UI on mobile)
  const vw = window.visualViewport ? Math.round(window.visualViewport.width) : window.innerWidth;
  const vh = window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight;

  // Decide using width primarily (most layout breakpoints are width-based).
  if (vw <= MOBILE_MAX) return true;
  if (vw >= DESKTOP_MIN) return false;

  // In the “gray zone”, keep previous state if known; otherwise use a simple heuristic
  if (isMobile !== null) return isMobile;

  // Fallback heuristic: very small height (e.g., landscape phones) is likely mobile UI
  return (vh < 500 || vw < 900);
}

function maybeNotify() {
  isMobile = computeIsMobile();
  if (isMobile !== prevIsMobile) {
    prevIsMobile = isMobile;
    console.log(isMobile ? 'Mobile UI' : 'desktop UI');
    updatePopupUI();
  }
}

function updatePopupUI() {
  const msg = {is_mobile: isMobile}
  browser.runtime.sendMessage(msg);
  console.log("Message sent from content script: ", msg);
}

function onViewportChange() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(maybeNotify, 120); // debounce rapid resizes/zoom
}

// Initial check
document.addEventListener("DOMContentLoaded", () => {
  maybeNotify();
});

// React to real viewport changes
window.addEventListener('resize', onViewportChange, { passive: true });
window.addEventListener('orientationchange', onViewportChange, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', onViewportChange, { passive: true });
  window.visualViewport.addEventListener('scroll', onViewportChange, { passive: true }); // mobile UI bars can move on scroll
}