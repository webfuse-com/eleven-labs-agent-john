document.addEventListener("DOMContentLoaded", () => {

    // Listen to messages from content script to set widget state
    browser.runtime.onMessage.addListener(message => {
        console.log("Message received in popup script: ", message);
        if (message.is_mobile === true) {
            setMobileUI();
        }
        else if (message.is_mobile === false) {
            setdesktopUI();
        }
    });
    // keep your popup window behaviors
    try {
        browser.browserAction.setPopupStyles({
            backgroundColor: "transparent",
            borderRadius: "20px",
            marginBottom: 0,
            paddingBottom: 0,
            overflow: "hidden",
        });
        browser.browserAction.resizePopup(350, 400);
        browser.browserAction.detachPopup();
        browser.browserAction.openPopup();
    } catch { /* ignore outside extension runtime */ }

    // Helpers that call into the UI API we expose in popup.elevenlabs.js
    (function () {
        function UI() { return window.voiceUI; }

        window.voiceActions = {
            focusInput() { try { UI()?.focusInput(); } catch (_) { } },
            startCall() { try { UI()?.start(); } catch (_) { } },
            endCall() { try { UI()?.end(); } catch (_) { } },
            toggleMute() { try { UI()?.toggleMute(); } catch (_) { } },
            send(text) { try { UI()?.send(text); } catch (_) { } },
        };

        // ⌘/Ctrl+Enter to send, Esc to end
        window.addEventListener("keydown", (e) => {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key === "Enter") {
                const val = UI()?.getInputValue?.() || "";
                if (val.trim()) {
                    e.preventDefault();
                    window.voiceActions.send(val);
                }
            } else if (e.key === "Escape") {
                window.voiceActions.endCall();
            }
        });

        // Focus after we’ve mounted UI
        window.addEventListener("voice-ui:ready", () => {
            setTimeout(() => window.voiceActions.focusInput(), 50);
        });
    })();
});

function setMobileUI() {
  console.log("Setting mobile UI for popup");
  browser.browserAction.resizePopup(250, 500);
  browser.browserAction.setPopupStyles({right:0, left:"auto"});
  const root = document.getElementById('va-root');
  if (root) root.setAttribute('data-variant', 'mobile');   // or data-mobile="true" if you prefer
}

function setdesktopUI() {
  console.log("Setting desktop UI for popup");
  browser.browserAction.resizePopup(350, 400);
  const root = document.getElementById('va-root');
  if (root) {
    root.removeAttribute('data-variant');                   // clear explicit mobile
    root.removeAttribute('data-mobile');
  }
}