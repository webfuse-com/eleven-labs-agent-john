// popup.elevenlabs.js
const LOG_PREFIX = "[popup.elevenlabs]";
const log = (...a) => console.log(LOG_PREFIX, ...a);
const warn = (...a) => console.warn(LOG_PREFIX, ...a);
const err = (...a) => console.error(LOG_PREFIX, ...a);

const qs = (s, r = document) => r.querySelector(s);
const chatEl = () => qs("#chat");
const rootEl = () => qs(".va-root");
const statusEl = () => qs("#status") || qs(".va-status-text") || qs('[data-role="status"]');
const inputEl = () => qs("#chat-input");
const formEl = () => qs("#input-form");
const muteBtn = () => qs("#btn-mute");
const endBtn = () => qs("#btn-end");
const startBtn = () => qs("#btn-start");

let toolsAvailable = false;
let currentToolName = null;
let toolActive = false;

function appendStatusFavicon(targetSpan) {
    if (!targetSpan) return;
    // avoid duplicates
    let img = targetSpan.querySelector('img.va-status-favicon');
    if (!img) {
        img = document.createElement('img');
        img.className = 'va-status-favicon';
        img.src = 'favicon.svg';      // lives at your extension root
        img.alt = '';
        img.width = 14;
        img.height = 14;
        img.decoding = 'async';
        img.loading = 'lazy';
        img.style.marginLeft = '6px';
    }
    targetSpan.appendChild(img);
}
function removeStatusFavicon(targetSpan) {
    targetSpan?.querySelector('img.va-status-favicon')?.remove();
}

// ==== ORB STATE CONTROL ====
const ORB_CLASS_IDLE = "is-idle";
const ORB_CLASS_THINK = "is-thinking";
const ORB_CLASS_SPEAK = "is-speaking";

let _speakDecayTimer = null;
let _rafEnergy = null;
let _currentOrbMode = "idle";
let _lastNonSpeakingMode = "idle"; // to restore after speaking ends

function orbCores() {
  // both header avatar orb and main orb share the same core class
  return Array.from(document.querySelectorAll(".va-orb-core"));
}

function setOrbMode(mode /* 'idle' | 'thinking' | 'speaking' */) {
  if (!mode) return;
  if (_currentOrbMode === mode) return;
  _currentOrbMode = mode;

  const cores = orbCores();
  const removeAll = (el) => el.classList.remove(ORB_CLASS_IDLE, ORB_CLASS_THINK, ORB_CLASS_SPEAK);
  cores.forEach((el) => {
    removeAll(el);
    if (mode === "idle") el.classList.add(ORB_CLASS_IDLE);
    else if (mode === "thinking") el.classList.add(ORB_CLASS_THINK);
    else if (mode === "speaking") el.classList.add(ORB_CLASS_SPEAK);
  });

  // Track last non-speaking mode so we can restore after speaking finishes
  if (mode !== "speaking") _lastNonSpeakingMode = mode;

  // Manage energy meter loop
  if (mode === "speaking") startEnergyMeter();
  else stopEnergyMeter();
}

function startEnergyMeter() {
  // If your SDK exposes outputFrequencyData/Analyser, map average to --energy (0..1)
  if (_rafEnergy) return;
  const cores = orbCores();

  const hasData = !!(conv?.outputFrequencyData && conv?.outputFrequencyData.length);
  if (!hasData) {
    // Fallback: gentle breathing between 0.6 ↔ 1.0 while speaking
    let t = 0;
    const tick = () => {
      t += 0.06;
      const energy = 0.8 + 0.2 * Math.sin(t); // ~0.6..1.0
      cores.forEach((el) => el.style.setProperty("--energy", String(energy.toFixed(3))));
      _rafEnergy = requestAnimationFrame(tick);
    };
    _rafEnergy = requestAnimationFrame(tick);
    return;
  }

  // Live RMS from outputFrequencyData
  const tick = () => {
    const arr = conv.outputFrequencyData; // Uint8Array 0..255
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    const avg = arr.length ? sum / arr.length : 0;     // 0..255
    let energy = Math.min(1, Math.max(0, (avg - 20) / 160)); // soften floor/ceiling
    energy = 0.55 + energy * 0.45; // map to ~0.55..1.0 for nicer glow

    cores.forEach((el) => el.style.setProperty("--energy", String(energy.toFixed(3))));
    _rafEnergy = requestAnimationFrame(tick);
  };
  _rafEnergy = requestAnimationFrame(tick);
}

function stopEnergyMeter() {
  if (_rafEnergy) {
    cancelAnimationFrame(_rafEnergy);
    _rafEnergy = null;
  }
}

// Debounce end of speech: after last audio chunk, wait a bit then restore non-speaking state
function nudgeSpeaking() {
  setOrbMode("speaking");
  if (_speakDecayTimer) clearTimeout(_speakDecayTimer);
  _speakDecayTimer = setTimeout(() => {
    setOrbMode(_lastNonSpeakingMode || "idle");
  }, 350); // ~1/3 sec after last audio chunk
}

// On first load, ensure idle class present
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => setOrbMode("idle"), 0);
});

function setState(state) {
    const root = rootEl();
    if (root) root.setAttribute("data-state", state);
    log("UI state ->", state);
}
function setStatus(keyOrText) {
    const el = statusEl();
    if (!el) {
        warn("Status element not found; expected #status or .va-status-text.");
        return;
    }

    const input = keyOrText || "";
    const key = String(input).toLowerCase();
    const normalizedKey = key.replace(/…|\.+$/g, ""); // strip ellipsis/punctuation

    const base = {
        idle: "Ready",
        connecting: "Connecting to agent…",
        connected: "Connected",
        listening: "Listening…",
        processing: "Thinking…",
        muted: "Muted",
    };
    let text = base[normalizedKey] || String(input);

    // If mic is muted, reflect Muted only when connected (avoid hiding pre-connect states)
    if (connected && typeof text === "string" && micMuted && normalizedKey !== "muted") {
        text = "Muted";
    }

    // Running tool label (explicit or via state key)
    if (String(input).startsWith("running_tool:") || key.startsWith("running_tool")) {
        const explicit = String(input).split(":")[1];
        const name = explicit || currentToolName || "action";
        text = `Running tool: ${name}`;
    } else if (toolActive && currentToolName) {
        // Only show running state if a tool is actively executing
        text = `Running tool: ${currentToolName}`;
    } else if (toolsAvailable && /listening|connected|ready|idle/i.test(text) && !micMuted) {
        // Enrich passive states with tool availability (but not when muted)
        text = `${text} (tools ready)`;
    }

    // Map status → orb visual mode
    try {
        const low = String(text || "").toLowerCase();
        if (low.includes("process") || low.includes("thinking") || low.includes("think")) {
            setOrbMode("thinking");
        } else {
            // For idle/connecting/connected/listening/muted, default to idle visuals.
            // Speaking is driven by audio events via nudgeSpeaking().
            setOrbMode("idle");
        }
    } catch (_) { /* noop */ }

    // Always reset the span’s text first…
    el.textContent = String(text).trim();
    // …then optionally append the favicon image only for custom-tool related statuses
    // Show for "Running tool: …" and when we've annotated passive states with "(tools ready)"
    if (text.startsWith("Running tool:") || /\(tools ready\)$/i.test(text)) {
        appendStatusFavicon(el);
    } else {
        removeStatusFavicon(el);
    }
    log("Status ->", text);
}
function updateMuteUI(opts = {}) {
    const { touchStatus = true } = opts;
    const btn = muteBtn && muteBtn();
    const iconEl = document.getElementById("mic-icon");

    // reflect pressed state for a11y/CSS
    if (btn) {
        btn.setAttribute("aria-pressed", micMuted ? "true" : "false");
        btn.dataset.muted = micMuted ? "true" : "false";
        // Highlight mute button when muted
        btn.classList.toggle("is-muted", !!micMuted);
    }

    // iconify swap
    if (iconEl) {
        iconEl.setAttribute("icon", micMuted ? "mage:microphone-mute" : "mage:microphone");
        iconEl.style.color = "#e5e7eb";
    }

    // Orb visuals:
    // - PRE-CONNECT => always full color (no dim classes)
    // - CONNECTED & MUTED => dim
    const shouldDim = !!(connected && micMuted);
    // Reflect mute state on root (for CSS-based dimming)
    try {
        const root = rootEl();
        if (root) {
            if (shouldDim) root.setAttribute("data-muted", "true");
            else root.removeAttribute("data-muted");
        }
    } catch (_) { }

    // Apply dimming classes to both wrappers and cores
    const dimTargets = [
        ...document.querySelectorAll(".va-orb"),
        ...document.querySelectorAll(".va-avatar"),
        ...document.querySelectorAll(".va-avatar--sm"),
        ...document.querySelectorAll(".va-orb-core")
    ];

    dimTargets.forEach((el) => {
        el.classList.toggle("va-orb--dim", shouldDim);
        el.classList.toggle("va-orb--muted", shouldDim && !el.classList.contains("va-orb--dim"));
        if (!shouldDim) {
            el.classList.remove("va-orb--muted");
            el.classList.remove("va-orb--dim");
        }
    });

    // Only rewrite status once connected
    if (touchStatus && connected) {
        setStatus(micMuted ? "muted" : "listening");
    }
}

async function setMuted(desired) {
    micMuted = !!desired;
    // Update UI icon immediately, but do not alter status unless connected
    updateMuteUI({ touchStatus: false });
    try {
        if (conv && typeof conv.setMicMuted === "function") {
            await conv.setMicMuted(micMuted);
        }
    } catch (e) {
        warn("setMuted failed:", e);
    }
    // After SDK action, if connected, reflect status
    if (connected) updateMuteUI({ touchStatus: true });
}
function appendMessage(role, text) {
    if (!text) return;
    const chat = chatEl();
    if (!chat) return;

    const row = document.createElement("div");
    row.className = `va-row ${role === "user" ? "user" : "agent"}`;

    const bubble = document.createElement("div");
    bubble.className = `va-bubble ${role === "user" ? "user" : "agent"}`;
    bubble.textContent = text;

    row.appendChild(bubble);
    chat.appendChild(row);
    chat.scrollTop = chat.scrollHeight;
    log(`UI: appended ${role.toUpperCase()} message:`, text);
    return { row, bubble };
}

let Conversation = null;
async function ensureSDKModule() {
    if (Conversation) return Conversation;
    try {
        const mod = await import("https://esm.sh/@elevenlabs/client");
        Conversation = mod.Conversation || mod.default?.Conversation;
        if (!Conversation) throw new Error("Conversation export missing");
        log("SDK (ESM) loaded from: https://esm.sh/@elevenlabs/client");
        return Conversation;
    } catch (e) {
        err("SDK ESM load failed:", e);
        throw e;
    }
}

let conv = null;
let connected = false;

// Mic state (UI + SDK)
let micMuted = true; // default UI state: muted

// Track the current in-progress (interim) user bubble so we can update it live
let _userDraft = { row: null, bubble: null };
// Push-To-Talk state
let _pttActive = false;
let _pttPrevMuted = null;
let _pttTargetMuted = null;

function clearChat() {
    try {
        const chat = chatEl();
        if (chat) chat.innerHTML = "";
        _userDraft = { row: null, bubble: null };
    } catch (_) { }
}

// ---------- EVENT MAPPING ----------
function handleClientEvent(evt) {
    if (!evt || !evt.type) return;
    if (evt.type === "ping") return; // ignore heartbeat noise
    log("onMessage event:", evt.type, evt);

    switch (evt.type) {
        case "user_transcript": {
            const e = evt.user_transcription_event || {};
            const t = e.user_transcript ?? e.transcript ?? e.text ?? "";
            const isFinal = e.is_final ?? e.isFinal ?? e.final ?? false;
            log("USER_TRANSCRIPT:", { transcript: t, isFinal });

            if (!t) break;

            const chat = chatEl();
            if (!chat) break;

            // If we have no draft bubble yet, create one
            if (!_userDraft.bubble) {
                const created = appendMessage("user", t);
                if (created) {
                    _userDraft = created;
                    _userDraft.bubble.classList.add("interim");
                }
            } else {
                // Update existing interim bubble text
                _userDraft.bubble.textContent = t;
                chat.scrollTop = chat.scrollHeight;
            }

            if (isFinal) {
                // Finalize the bubble: remove interim styling and clear draft pointer
                _userDraft.bubble.classList.remove("interim");
                _userDraft = { row: null, bubble: null };
                setStatus("processing");
            }
            break;
        }

        case "agent_response": {
            // 🔧 CHANGED: 1) parse modern blocks, 2) fallback to legacy `agent_response` string
            const ar = evt.agent_response_event || {};
            let text = "";

            // Newer shape
            const out = ar.response?.output;
            if (Array.isArray(out)) {
                const pieces = [];
                for (const block of out) {
                    const content = block?.content;
                    if (Array.isArray(content)) {
                        for (const c of content) if (c?.text) pieces.push(c.text);
                    }
                }
                text = pieces.join("\n").trim();
            }

            // Legacy simple string
            if (!text && typeof ar.agent_response === "string") {
                text = ar.agent_response.trim();
            }

            log("AGENT_RESPONSE parsed text:", text || "(none)");
            setStatus(micMuted ? "muted" : "listening");
            toolActive = false;
            currentToolName = null;
            if (_userDraft.bubble) { _userDraft.bubble.classList.remove("interim"); _userDraft = { row: null, bubble: null }; }
            if (text) appendMessage("agent", text);
            break;
        }

        case "client_tool_call": {
            // Normalize various shapes we have seen in the wild
            const call = evt.client_tool_call || evt.agent_tool_call || evt.tool_call || {};
            const name = call.client_tool_name || call.tool_name || call.name || call.tool || call.type || "tool";
            currentToolName = String(name);
            toolActive = true;
            setStatus(`running_tool:${currentToolName}`);
            break;
        }

        case "agent_tool_call": {
            const call = evt.agent_tool_call || evt.client_tool_call || evt.tool_call || {};
            const name = call.client_tool_name || call.tool_name || call.name || call.tool || call.type || "tool";
            currentToolName = String(name);
            toolActive = true;
            setStatus(`running_tool:${currentToolName}`);
            break;
        }

        case "agent_tool_response": {
            const resp = evt.agent_tool_response || evt.client_tool_response || {};
            const name = resp.tool_name || currentToolName || "action";
            const isError = !!resp.is_error;
            log("AGENT_TOOL_RESPONSE:", { name, isError, id: resp.tool_call_id, event: resp });

            // Mark tool as finished and revert status
            toolActive = false;
            currentToolName = null;
            setStatus(micMuted ? "muted" : "listening");
            break;
        }

        case "audio": {
            // keep lightweight trace only; avoid console spam
            const len = evt.audio_event?.audio_base_64?.length || 0;
            if (len) {
                log("AUDIO chunk received. base64Length:", len);
                // Drive the orb "speaking" animation with outgoing audio
                try { nudgeSpeaking(); } catch (_) {}
            }
            return; // do not fall through to default
        }

        case "conversation_initiation_metadata": {
            // keep for completeness
            log("CONVERSATION_INIT:", evt.conversation_initiation_metadata_event);
            break;
        }

        default:
            // keep visible while we align with your build
            log("UNHANDLED event (logged only):", evt.type);
            break;
    }
}

function bindConversationEvents(c) {
    if (!c) return;

    if (typeof c.onMessage === "function") {
        log("conv.onMessage is available — attaching.");
        c.onMessage(handleClientEvent);
    } else {
        warn("conv.onMessage missing; will rely on connection fallback if present.");
    }

    // Fallback wrapper for builds that emit via connection.onMessageCallback
    const conn = c.connection;
    if (conn && typeof conn.onMessageCallback === "function") {
        log("Wrapping connection.onMessageCallback");
        const original = conn.onMessageCallback;
        conn.onMessageCallback = (evt) => {
            try { handleClientEvent(evt); } catch (e) { warn("handleClientEvent error:", e); }
            return original.call(conn, evt);
        };
    }

    // Optional live status/mode hooks if this SDK build exposes them
    try {
        if (typeof c.onStatusChange === "function") {
            c.onStatusChange((s) => {
                const k = String(s || "").toLowerCase();
                if (k.includes("listen")) setStatus(micMuted ? "muted" : "listening");
                else if (k.includes("process") || k.includes("think")) setStatus("processing");
                else if (k.includes("connect")) setStatus("connecting");
                else if (k.includes("disconnect")) setStatus("Idle");
            });
        }
    } catch (_) { }

    try {
        if (typeof c.onModeChange === "function") {
            c.onModeChange((m) => {
                if (String(m || "").toLowerCase().includes("voice")) {
                    setStatus(micMuted ? "muted" : "listening");
                }
            });
        }
    } catch (_) { }

    // Hard disconnect safety: reflect UI and clear chat
    try {
        const conn2 = c.connection || c;
        if (conn2 && typeof conn2.onDisconnectCallback === "function") {
            const prev = conn2.onDisconnectCallback;
            conn2.onDisconnectCallback = (...args) => {
                try { setStatus("Idle"); setState("idle"); clearChat(); connected = false; } catch (_) { }
                return prev?.apply(conn2, args);
            };
        }
    } catch (_) { }
}

// ---------- TEXT SEND (dual path) ----------
async function sendUserMessageEvent(text) {
    if (!conv) return warn("No active conversation.");
    const str = String(text || "");

    // Try to barge-in: fade out current TTS if supported
    try { conv?.fadeOutAudio?.(); } catch (_) { }

    // 1) Preferred path: documented helper (exists in your build)
    if (typeof conv.sendUserMessage === "function") {
        try {
            await conv.sendUserMessage(str);
            log("sendUserMessage() dispatched.");
            // no return — we still fall through to (2) to guarantee agent wakes up
        } catch (e) {
            warn("sendUserMessage failed:", e);
        }
    }

    // 2) Compatibility shim (what your voice path definitely reacts to):
    //    push a *final* user_transcript over the RTC data channel.
    try {
        const lp = conv.connection?.room?.localParticipant;
        if (lp && typeof lp.publishData === "function") {
            const payload = {
                type: "client_event",
                client_event: {
                    type: "user_transcript",
                    user_transcription_event: { user_transcript: str, is_final: true }
                }
            };
            log('Sending client_event:user_transcript via publishData (topic="client_event"):', payload.client_event);
            lp.publishData(JSON.stringify(payload), 2, undefined, "client_event");
            log("Sent typed transcript via data channel.");
        } else {
            warn("No data channel present; cannot push transcript compatibility event.");
        }
    } catch (e) {
        warn("publishData transcript shim failed:", e);
    }

    if (_userDraft.bubble) { _userDraft.bubble.classList.remove("interim"); _userDraft = { row: null, bubble: null }; }
}

// ---------- SESSION ----------
async function startSession() {
    log("Click start");

    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        log("Mic OK");
    } catch (e) {
        err("Mic permission failed:", e);
        return;
    }

    const AGENT_ID =
        (window.browser && browser.webfuseSession && browser.webfuseSession.env && browser.webfuseSession.env.AGENT_KEY) ||
        (window.env && env.AGENT_KEY);

    log("startSession agentId:", AGENT_ID);
    if (!AGENT_ID) {
        err("Missing env.AGENT_KEY");
        return;
    }

    try {
        await ensureSDKModule();
        setState("connected");
        setStatus("connecting");

        // Ensure the UI shows the connect flow; prepare muted icon without changing status
        micMuted = true;
        updateMuteUI({ touchStatus: false });

        conv = await Conversation.startSession({
            agentId: AGENT_ID,
            connectionType: "webrtc",
            clientTools: window.CLIENT_TOOLS,
        });

        log("Conversation ready. Keys:", Object.keys(conv || {}));
        const methods = {};
        ["onMessage", "sendUserMessage", "setMicMuted"].forEach(k => {
            try { methods[k] = typeof conv?.[k]; } catch { methods[k] = "n/a"; }
        });
        log("Methods:", methods);

        bindConversationEvents(conv);

        // SDK-provided high-level callbacks (if present in this build)
        try {
            if (typeof conv.onStatusChange === "function") {
                conv.onStatusChange((s) => {
                    const k = String(s || "").toLowerCase();
                    if (k.includes("listen")) setStatus(micMuted ? "muted" : "listening");
                    else if (k.includes("process") || k.includes("think")) setStatus("processing");
                    else if (k.includes("connect")) setStatus("connecting");
                    else if (k.includes("disconnect")) setStatus("Idle");
                });
            }
            if (typeof conv.onModeChange === "function") {
                conv.onModeChange((m) => {
                    if (String(m || "").toLowerCase().includes("voice")) setStatus(micMuted ? "muted" : "listening");
                });
            }
            if (typeof conv.onDisconnect === "function") {
                conv.onDisconnect(() => { setStatus("Idle"); setState("idle"); clearChat(); connected = false; });
            }
            if (typeof conv.onError === "function") {
                conv.onError((e) => warn("SDK error:", e));
            }
        } catch (_) { }

        toolsAvailable = !!(window.CLIENT_TOOLS && Object.keys(window.CLIENT_TOOLS).length);

        connected = true;

        // Enforce muted mic on start, now that we're connected;
        // do not clobber status if SDK takes a moment to settle.
        await setMuted(true);
    } catch (e) {
        err("startSession error:", e);
        setStatus("Idle");
        setState("idle");
    }
}

async function endSession() {
    try { await conv?.endSessionWithDetails?.({ reason: "user_ended" }); } catch { }
    try { await conv?.connection?.room?.disconnect?.(); } catch { }
    conv = null;
    connected = false;
    toolActive = false;
    currentToolName = null;
    micMuted = true;
    _pttActive = false;
    _pttPrevMuted = null;
    _pttTargetMuted = null;

    // Clear chat and draft bubbles for a fresh page on next connect
    clearChat();

    // Update icon only; keep explicit Idle/Ready status visible
    updateMuteUI({ touchStatus: false });
    setStatus("Idle");
    setState("idle");
}

async function toggleMute() {
    // allow toggling UI state even before connection; SDK call will no-op until connected
    await setMuted(!micMuted);
}

// ---------- UI ----------
function wireUI() {
    startBtn()?.addEventListener("click", (e) => { e.preventDefault(); startSession(); });
    endBtn()?.addEventListener("click", (e) => { e.preventDefault(); endSession(); });
    muteBtn()?.addEventListener("click", (e) => { e.preventDefault(); toggleMute(); });

    // Ensure initial UI icon shows muted state on load
    updateMuteUI();

    formEl()?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const v = inputEl()?.value?.trim();
        if (!v) return;
        // Create a draft bubble immediately for typed text, same as voice interim
        const created = appendMessage("user", v);
        if (created) { _userDraft = created; _userDraft.bubble.classList.add("interim"); }
        inputEl().value = "";
        log("Sending text to agent:", v);
        await sendUserMessageEvent(v);
    });
    // Push-To-Talk / Push-To-Mute (momentary invert):
    // Holding Space temporarily flips the current mic state.
    // - If muted, holding Space un-mutes while held (classic PTT).
    // - If unmuted, holding Space mutes while held (push-to-mute).
    const _isEditableTarget = () => {
        const ae = document.activeElement;
        const tag = (ae && ae.tagName ? ae.tagName.toLowerCase() : "");
        return ae && (ae.isContentEditable || tag === "input" || tag === "textarea");
    };

    const _pttRestore = async () => {
        if (!_pttActive) return;
        _pttActive = false;
        try {
            if (connected && _pttPrevMuted !== null) {
                await setMuted(_pttPrevMuted);
            }
        } catch (_) { }
        _pttPrevMuted = null;
        _pttTargetMuted = null;
    };

    window.addEventListener(
        "keydown",
        async (e) => {
            if (e.code !== "Space") return;
            if (_isEditableTarget()) return;   // don’t hijack typing in inputs
            if (_pttActive) return;            // ignore auto-repeat

            // Prevent page scroll
            e.preventDefault();

            _pttActive = true;
            _pttPrevMuted = micMuted;          // remember prior state
            _pttTargetMuted = !micMuted;       // invert while held

            if (connected) {
                try { await setMuted(_pttTargetMuted); } catch (_) { }
            }
        },
        { passive: false }
    );

    window.addEventListener("keyup", async (e) => {
        if (e.code !== "Space") return;
        await _pttRestore();
    });

    // Safety: if the window loses focus or becomes hidden while Space is held, restore prior state.
    window.addEventListener("blur", _pttRestore);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") _pttRestore();
    });

}

document.addEventListener("DOMContentLoaded", () => {
    setState("idle");
    setStatus("Idle");
    micMuted = true;              // start with muted icon
    updateMuteUI({ touchStatus: false });  // don't override visible "Idle"
    wireUI();
});