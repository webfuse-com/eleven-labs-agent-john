// ==========================================================
// CLIENT TOOLS (exactly as you specified; preserved verbatim)
// ==========================================================
const snapshotSelector = "#main-container > div.page-wrapper > div";
const CLIENT_TOOLS = {
async take_dom_snapshot() {
  const finalSnapshot = await browser.webfuseSession.automation.take_dom_snapshot({
    rootSelector: snapshotSelector,
    deep: true // keep
    // ← no modifier: capture full HTML, not a distilled sketch
  });
  console.debug("Snapshot length:", finalSnapshot?.length || 0);
  return finalSnapshot;
},
    async left_click({ selector }) {
        return browser.webfuseSession
            .automation
            .leftClick(selector, true);
    },

    async type({ text, selector }) {
        return browser.webfuseSession
            .automation
            .type(text, fixedSelector, true, true); // moveMouse: true, overwrite: true
    },

    relocate({ url }) {
        browser.webfuseSession.relocate(url);
    }
};

// Make available to other files
window.CLIENT_TOOLS = CLIENT_TOOLS;

// Nothing else is instantiated here now — popup.elevenlabs.js handles
// the SDK wiring and UI state, and will read env + CLIENT_TOOLS.