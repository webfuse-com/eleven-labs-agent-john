// ==========================================================
// CLIENT TOOLS (exactly as you specified; preserved verbatim)
// ==========================================================
const CLIENT_TOOLS = {
    async takeDomSnapshot() {
        const fullSnapshot = await browser.webfuseSession
            .automation
            .takeDomSnapshot();
        return ((fullSnapshot.length / 4) < 2**15)
            ? fullSnapshot
            : browser.webfuseSession
                .automation
                .takeDomSnapshot({
                    modifier: "downsample"
                });
    },
    async leftClick({ selector }) {
        return browser.webfuseSession
            .automation
            .leftClick(selector, true);
    },

    async type({ text, selector }) {
        return browser.webfuseSession
            .automation
            .type(text, selector, true);
    },

    relocate({ url }) {
        browser.webfuseSession.relocate(url);
    }
};

// Make available to other files
window.CLIENT_TOOLS = CLIENT_TOOLS;

// Nothing else is instantiated here now — popup.elevenlabs.js handles
// the SDK wiring and UI state, and will read env + CLIENT_TOOLS.