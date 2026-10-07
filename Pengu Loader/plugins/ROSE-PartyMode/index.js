/**
 * @name Rose-PartyMode
 * @author Rose Team
 * @description Party Mode - See your friends' skins in game via P2P
 * @link https://github.com/Alban1911/Rose
 */
(function initPartyMode() {
  const LOG_PREFIX = "[Rose-PartyMode]";

  // Rose's menu language (ROSE-I18n); English until it has loaded
  const t = (text, vars) =>
    window.RoseI18n
      ? window.RoseI18n.t(text, vars)
      : text.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
  // A message from Rose: its template and values when it has variables
  const tMessage = (message, template, values) => (template ? t(template, values) : t(message));
  let BRIDGE_PORT = 50000;
  let BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
  const BRIDGE_PORT_STORAGE_KEY = "rose_bridge_port";
  const DISCOVERY_START_PORT = 50000;
  const DISCOVERY_END_PORT = 50010;

  const PANEL_ID = "rose-party-panel";
  const BACKDROP_ID = "rose-party-backdrop";
  const BUTTON_ID = "rose-party-button";
  const LOBBY_BUTTON_ID = "rose-party-lobby-button";

  let bridgeSocket = null;
  let bridgeReady = false;
  let bridgeQueue = [];
  let partyPanel = null;
  let lobbyButton = null;
  let isVisible = false;
  let panelLocked = false;
  let currentUIMode = null; // 'lobby' or 'champselect'

  // Party state
  let partyState = {
    enabled: false,
    connection: "offline",
    my_token: null,
    my_summoner_id: null,
    my_summoner_name: "Unknown",
    peers: [],
  };

  /**
   * Escape HTML special characters to prevent XSS
   */
  function escapeHtml(str) {
    if (typeof str !== "string") return str;
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Load bridge port with file-based discovery and localStorage caching
  async function loadBridgePort() {
    try {
      const cachedPort = localStorage.getItem(BRIDGE_PORT_STORAGE_KEY);
      if (cachedPort) {
        const port = parseInt(cachedPort, 10);
        if (!isNaN(port) && port > 0) {
          try {
            const response = await fetch(
              `http://127.0.0.1:${port}/bridge-port`,
              { signal: AbortSignal.timeout(50) }
            );
            if (response.ok) {
              const portText = await response.text();
              const fetchedPort = parseInt(portText.trim(), 10);
              if (!isNaN(fetchedPort) && fetchedPort > 0) {
                BRIDGE_PORT = fetchedPort;
                BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
                console.log(
                  `${LOG_PREFIX} Loaded bridge port from cache: ${BRIDGE_PORT}`
                );
                return true;
              }
            }
          } catch (e) {
            localStorage.removeItem(BRIDGE_PORT_STORAGE_KEY);
          }
        }
      }

      // Try default port 50000
      try {
        const response = await fetch(`http://127.0.0.1:50000/bridge-port`, {
          signal: AbortSignal.timeout(50),
        });
        if (response.ok) {
          const portText = await response.text();
          const fetchedPort = parseInt(portText.trim(), 10);
          if (!isNaN(fetchedPort) && fetchedPort > 0) {
            BRIDGE_PORT = fetchedPort;
            BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
            localStorage.setItem(BRIDGE_PORT_STORAGE_KEY, String(BRIDGE_PORT));
            console.log(`${LOG_PREFIX} Loaded bridge port: ${BRIDGE_PORT}`);
            return true;
          }
        }
      } catch (e) {
        // Continue to discovery
      }

      // Parallel port discovery
      const portPromises = [];
      for (let port = DISCOVERY_START_PORT; port <= DISCOVERY_END_PORT; port++) {
        portPromises.push(
          fetch(`http://127.0.0.1:${port}/bridge-port`, {
            signal: AbortSignal.timeout(100),
          })
            .then((response) => {
              if (response.ok) {
                return response.text().then((portText) => {
                  const fetchedPort = parseInt(portText.trim(), 10);
                  if (!isNaN(fetchedPort) && fetchedPort > 0) {
                    return { port: fetchedPort };
                  }
                  return null;
                });
              }
              return null;
            })
            .catch(() => null)
        );
      }

      const results = await Promise.allSettled(portPromises);
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          BRIDGE_PORT = result.value.port;
          BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
          localStorage.setItem(BRIDGE_PORT_STORAGE_KEY, String(BRIDGE_PORT));
          console.log(`${LOG_PREFIX} Loaded bridge port: ${BRIDGE_PORT}`);
          return true;
        }
      }

      console.warn(
        `${LOG_PREFIX} Failed to load bridge port, using default (50000)`
      );
      return false;
    } catch (e) {
      console.warn(`${LOG_PREFIX} Error loading bridge port:`, e);
      return false;
    }
  }

  function getCSSRules() {
    return `
    @font-face {
      font-family: "Beaufort for LOL";
      src: url("http://127.0.0.1:${BRIDGE_PORT}/asset/BeaufortforLOL-Regular.ttf") format("truetype");
      font-weight: normal;
      font-style: normal;
      font-display: swap;
    }

    /* Party Button */
    /* Backdrop: League's modal backdrop (lol-uikit-full-page-backdrop) */
    #${BACKDROP_ID} {
      position: fixed;
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
      background: linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.8) 93%);
      z-index: 9997;
      display: none;
    }

    #${BACKDROP_ID}.visible {
      display: block;
    }

    /* Party Panel */
    /* ===== Panel: League's own lol-uikit-dialog-frame, laid out like the Add Friends modal ===== */
    #${PANEL_ID} {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 420px;
      z-index: 9998;
      display: none;
      flex-direction: column;
      cursor: default;
      -webkit-font-smoothing: antialiased;
      font-kerning: normal;
    }

    #${PANEL_ID} .party-dialog {
      display: block;
      width: 100%;
    }

    /* .lol-friend-finder-modal: padding 0 18px, room below for the footer button */
    #${PANEL_ID} .party-modal {
      display: flex;
      flex-direction: column;
      padding: 0 18px 34px;
    }

    /* The footer button sits on the frame's bottom edge, like "Done" in League's modals */
    #${PANEL_ID} .party-footer {
      position: absolute;
      left: 50%;
      bottom: -14px;
      transform: translateX(-50%);
      z-index: 1;
    }

    #${PANEL_ID} .party-footer lol-uikit-flat-button {
      min-width: 110px;
    }

    #${PANEL_ID}.visible {
      display: flex;
    }

    /* Title — .lol-friend-finder-modal .title (centered, margin 15px 0 10px) */
    .party-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin: 15px 0 10px;
    }

    .party-header h3 {
      margin: 0;
      color: #f0e6d2;
      font-family: var(--font-display), "Beaufort for LOL", Arial, sans-serif;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: .05em;
      line-height: 22px;
      text-transform: uppercase;
    }

    .party-status {
      margin-top: 2px;
      font-family: var(--font-body), Arial, sans-serif;
      font-size: 12px;
      font-weight: 400;
      letter-spacing: .025em;
    }

    .party-status.offline { color: #5b5a56; }
    .party-status.online  { color: #0acbe6; }
    .party-status.reconnecting { color: #c8aa6e; }

    /* Body — matches .lol-friend-finder-modal .modal-body */
    .party-content {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }

    /* Description text */
    .party-description {
      color: #a09b8c;
      font-family: var(--font-body), Arial, sans-serif;
      font-size: 12px;
      line-height: 16px;
      margin-bottom: 15px;
    }

    /* Section headers — matches .lol-friend-finder-modal .header */
    .party-section {
      margin-bottom: 15px;
    }

    .party-section:last-child {
      margin-bottom: 0;
    }

    .party-section-title {
      color: #f0e6d2;
      font-family: var(--font-display), "Beaufort for LOL", Arial, sans-serif;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .075em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }

    /* Inputs — matches lol-uikit-flat-input */
    .token-container,
    .add-peer-container {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }

    .token-input,
    .add-peer-input {
      flex: 1;
      background: rgba(0,0,0,.7);
      border: thin solid #3c3c41;
      padding: 7px 10px;
      color: #f0e6d2;
      font-family: var(--font-body), Arial, sans-serif;
      font-size: 12px;
      line-height: 18px;
      outline: none;
    }

    .token-input {
      font-family: monospace;
      font-size: 11px;
      color: #a09b8c;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .token-input:focus,
    .add-peer-input:focus {
      border-color: #c89b3c;
    }

    .add-peer-input::placeholder {
      color: #5b5a56;
    }

    /* Buttons — matches lol-uikit-flat-button-secondary */
    .copy-btn, .add-btn {
      background: transparent;
      border: thin solid #5b5a56;
      padding: 7px 16px;
      color: #cdbe91;
      cursor: pointer;
      font-family: var(--font-body), Arial, sans-serif;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .075em;
      text-transform: uppercase;
      white-space: nowrap;
      transition: color .3s, border-color .3s;
    }

    .copy-btn:hover, .add-btn:hover {
      border-color: #c8aa6e;
      color: #f0e6d2;
    }

    .copy-btn:active, .add-btn:active {
      color: #463714;
      border-color: #463714;
    }

    .copy-btn.copied {
      border-color: #0acbe6;
      color: #0acbe6;
    }

    .add-btn:disabled, .add-peer-input:disabled {
      opacity: 0.5;
      cursor: default;
      pointer-events: none;
    }

    /* Toggle button — matches lol-uikit-flat-button (primary) */
    .party-toggle-btn {
      width: 100%;
      padding: 10px;
      cursor: pointer;
      font-family: var(--font-body), Arial, sans-serif;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: .1em;
      text-transform: uppercase;
      border: thin solid #c8aa6e;
      transition: background .3s, color .3s, border-color .3s;
    }

    .party-toggle-btn.enable {
      background: linear-gradient(to bottom, #1e2328, #1e2328);
      border-color: #c8aa6e;
      color: #cdbe91;
    }

    .party-toggle-btn.enable:hover {
      background: linear-gradient(to bottom, #1e2328, #1e2328);
      border-color: #c8aa6e;
      color: #f0e6d2;
    }

    .party-toggle-btn.disable {
      background: transparent;
      border-color: #5b5a56;
      color: #a09b8c;
    }

    .party-toggle-btn.disable:hover {
      border-color: #ff4646;
      color: #ff4646;
    }

    .party-toggle-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    /* Peers list — matches requested-players / recent-summoners */
    .peers-list {
      max-height: 200px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: #463714 transparent;
    }

    .peers-list::-webkit-scrollbar { width: 6px; }
    .peers-list::-webkit-scrollbar-track { background: transparent; }
    .peers-list::-webkit-scrollbar-thumb { background: #463714; border-radius: 3px; }

    .peer-item {
      display: flex;
      align-items: center;
      padding: 6px 0;
      border-bottom: thin solid rgba(60,60,65,.5);
    }

    .peer-item:last-child {
      border-bottom: none;
    }

    .peer-info {
      flex: 1;
      min-width: 0;
    }

    .peer-name {
      color: #a09b8c;
      font-family: var(--font-body), Arial, sans-serif;
      font-size: 12px;
      line-height: 16px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .peer-item:hover .peer-name {
      color: #f0e6d2;
    }

    .peer-status {
      font-family: var(--font-body), Arial, sans-serif;
      font-size: 10px;
      color: #5b5a56;
      line-height: 14px;
    }

    .peer-status.in-lobby { color: #0acbe6; }

    .peer-skin {
      font-size: 10px;
      color: #c89b3c;
      line-height: 14px;
    }

    .peer-remove {
      background: none;
      border: none;
      color: #5b5a56;
      cursor: pointer;
      padding: 4px 8px;
      font-size: 14px;
      transition: color .2s;
    }

    .peer-remove:hover { color: #ff4646; }

    .no-peers {
      color: #5b5a56;
      font-family: var(--font-body), Arial, sans-serif;
      font-size: 12px;
      text-align: center;
      padding: 20px;
    }


    /* Loading state */
    .loading {
      opacity: 0.6;
      pointer-events: none;
    }

    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(200, 170, 110, 0.3);
      border-top-color: #c8aa6e;
      border-radius: 50%;
      animation: rose-party-spin 0.8s linear infinite;
    }

    @keyframes rose-party-spin {
      to { transform: rotate(360deg); }
    }

    /* Messages */
    .error-msg {
      color: #ff4646;
      font-size: 11px;
      margin-top: 8px;
    }

    .success-msg {
      color: #0acbe6;
      font-size: 11px;
      margin-top: 8px;
    }

    /* Lobby action bar button - matches native social bar buttons */
    #${LOBBY_BUTTON_ID} {
      position: relative;
      cursor: pointer;
    }

    #${LOBBY_BUTTON_ID} .party-mode-icon {
      background-color: #c8aa6e;
      cursor: pointer;
      display: block;
      height: inherit;
      width: inherit;
      -webkit-mask: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E") no-repeat center;
      -webkit-mask-size: 18px;
    }

    #${LOBBY_BUTTON_ID}:hover .party-mode-icon {
      background-color: #f0e6d2;
    }

    #${LOBBY_BUTTON_ID}:active .party-mode-icon {
      background-color: #463714;
    }

    #${LOBBY_BUTTON_ID}.active .party-mode-icon {
      background-color: #0acbe6;
    }

    #${LOBBY_BUTTON_ID}.connected .party-mode-icon {
      background-color: #4ade80;
    }

    `;
  }

  function injectStyles() {
    const styleId = "rose-party-mode-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = getCSSRules();
    document.head.appendChild(style);
  }

  // Attach a native Riot tooltip to an element
  function attachTooltip(el, text) {
    let wrapper = null;
    el.addEventListener("mouseenter", () => {
      // Wrapper div to control positioning (native tooltip may override its own styles)
      wrapper = document.createElement("div");
      wrapper.style.cssText = "position:fixed;pointer-events:none;z-index:10000;visibility:hidden";
      const tip = document.createElement("lol-uikit-tooltip");
      tip.setAttribute("data-tooltip-position", "bottom");
      const content = document.createElement("lol-uikit-content-block");
      content.setAttribute("type", "tooltip-system");
      const p = document.createElement("p");
      p.textContent = t(text);
      content.appendChild(p);
      tip.appendChild(content);
      wrapper.appendChild(tip);
      document.body.appendChild(wrapper);
      // Wait for render then position the wrapper
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!wrapper || !wrapper.isConnected) return;
          const btnRect = el.getBoundingClientRect();
          const wrapRect = wrapper.getBoundingClientRect();
          const centerX = btnRect.left + btnRect.width / 2;
          wrapper.style.left = `${centerX - wrapRect.width / 2}px`;
          wrapper.style.top = `${btnRect.bottom}px`;
          wrapper.style.visibility = "visible";
        });
      });
    });
    el.addEventListener("mouseleave", () => {
      if (wrapper) {
        wrapper.remove();
        wrapper = null;
      }
    });
  }

  // Create button in social actions bar
  function createLobbyButton() {
    const existing = document.getElementById(LOBBY_BUTTON_ID);
    if (existing) {
      lobbyButton = existing;
      updateLobbyButtonState();
      return;
    }

    // Find the social actions bar buttons container
    const buttonsContainer = document.querySelector(".lol-social-actions-bar .buttons");
    if (!buttonsContainer) {
      console.log(`${LOG_PREFIX} Social actions bar not found, retrying...`);
      return false;
    }

    // Find the friend-finder-button to insert before it
    const friendFinderBtn = buttonsContainer.querySelector(".friend-finder-button");
    const friendFinderParent = friendFinderBtn ? friendFinderBtn.closest(".action-bar-button") : null;

    const button = document.createElement("span");
    button.id = LOBBY_BUTTON_ID;
    button.className = "action-bar-button";
    button.innerHTML = `
      <span class="party-mode-icon"></span>
    `;

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });
    // Use an automated label instead of "Party Mode" which gets translated to "Grup modu"
    attachTooltip(button, "403Changer");

    // Insert before the add friend button, or append to the end
    if (friendFinderParent) {
      buttonsContainer.insertBefore(button, friendFinderParent);
    } else {
      // Try to insert after the SOCIAL header
      const socialHeader = buttonsContainer.querySelector(".friend-header");
      if (socialHeader && socialHeader.nextSibling) {
        buttonsContainer.insertBefore(button, socialHeader.nextSibling);
      } else {
        buttonsContainer.appendChild(button);
      }
    }

    lobbyButton = button;
    updateLobbyButtonState();
    return true;
  }

  function updateLobbyButtonState() {
    if (!lobbyButton) return;

    const inLobbyOrChamp = isInLobby() || isInChampSelect();
    const connectedPeers = (partyState.peers || []).filter((p) => p.connected);
    
    // As per user request: blue (active) when lobby is open, normal color otherwise.
    if (inLobbyOrChamp || connectedPeers.length > 0) {
      lobbyButton.classList.add("active");
    } else {
      lobbyButton.classList.remove("active");
      lobbyButton.classList.remove("connected");
    }
  }

  function createPartyPanel() {
    // Remove any existing panel (may be detached/stale)
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      if (existing.isConnected && partyPanel === existing) return; // Already good
      existing.remove();
    }
    const existingBackdrop = document.getElementById(BACKDROP_ID);
    if (existingBackdrop) existingBackdrop.remove();

    // Find a persistent container to attach the panel to
    const container = document.querySelector(".lol-social-actions-bar") || document.body;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <lol-uikit-dialog-frame class="party-dialog" orientation="bottom" close-button>
      <div class="party-modal">
      <div class="party-header">
        <h3>403Changer - Party Mode</h3>
        <span class="party-status online">${t("Always-On")}</span>
      </div>
      <div class="party-content">
        <div class="party-description" style="color:#0acbe6;font-weight:bold;">
          ${t("Aynı lobide 403Changer kullanan oyuncular otomatik olarak eşleşir. Kod girmenize gerek yoktur.")}
        </div>

        <div class="party-section" id="party-peers-section">
          <div class="party-section-title">${t("Lobideki Bağlı Oyuncular")} (<span id="peer-count">0</span>)</div>
          <div class="peers-list" id="peers-list">
            <div class="no-peers">${t("Lobide bağlı 403Changer kullanıcısı bekleniyor...")}</div>
          </div>
        </div>

        <div class="party-section" id="party-toggle-section" style="display: none;">
          <button class="party-toggle-btn enable" id="party-toggle-btn" style="display: none;"></button>
          <div id="party-toggle-message"></div>
        </div>
        <div class="party-section" id="party-token-section" style="display: none;">
          <input type="text" id="party-token-display" style="display: none;">
          <button id="copy-token-btn" style="display: none;"></button>
        </div>
        <div class="party-section" id="party-add-section" style="display: none;">
          <input type="text" id="add-peer-input" style="display: none;">
          <button id="add-peer-btn" style="display: none;"></button>
          <div id="add-peer-message"></div>
        </div>
      </div>
      </div>
      </lol-uikit-dialog-frame>
      <div class="party-footer">
        <lol-uikit-flat-button id="party-done-btn">${t("Done")}</lol-uikit-flat-button>
      </div>
    `;

    // Dims the client behind the panel; clicking it closes the panel
    const backdrop = document.createElement("div");
    backdrop.id = BACKDROP_ID;
    backdrop.addEventListener("click", () => closePanel());

    try {
      container.appendChild(backdrop);
      container.appendChild(panel);
      partyPanel = panel;
      // Use querySelector on panel directly instead of document to avoid ID conflicts
      panel.querySelector("#party-toggle-btn").addEventListener("click", handleToggleParty);
      panel.querySelector("#copy-token-btn").addEventListener("click", handleCopyToken);
      panel.querySelector("#add-peer-btn").addEventListener("click", handleAddPeer);
      panel.querySelector("#add-peer-input").addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleAddPeer();
      });
      panel.querySelector(".party-dialog").addEventListener("dialogFrameDismissed", () => closePanel());
      panel.querySelector("#party-done-btn").addEventListener("click", () => closePanel());
    } catch (e) {
      console.error(`${LOG_PREFIX} Failed to create panel:`, e);
      partyPanel = null;
    }
  }

  // Closing is disabled while a friend is being added
  function closePanel() {
    if (!panelLocked) setPanelVisible(false);
  }

  // A new menu language (ROSE-I18n): rebuild the panel in it, open or closed as it was
  window.addEventListener("rose-i18n-changed", () => {
    const wasVisible = isVisible;
    if (partyPanel) partyPanel.remove();
    partyPanel = null;
    isVisible = false;
    createPartyPanel();
    if (wasVisible) setPanelVisible(true);
    updatePanelState();
  });

  function setPanelLocked(locked) {
    panelLocked = locked;
    if (!partyPanel) return;
    const frame = partyPanel.querySelector(".party-dialog");
    if (frame) {
      if (locked) frame.removeAttribute("close-button");
      else frame.setAttribute("close-button", "");
    }
    const doneBtn = partyPanel.querySelector("#party-done-btn");
    if (doneBtn) doneBtn.style.display = locked ? "none" : "";
  }

  function setPanelVisible(visible) {
    isVisible = visible;
    if (partyPanel) partyPanel.classList.toggle("visible", visible);
    const backdrop = document.getElementById(BACKDROP_ID);
    if (backdrop) backdrop.classList.toggle("visible", visible);
  }

  function togglePanel() {
    // Recreate panel if it was removed from DOM
    if (!partyPanel || !partyPanel.isConnected) {
      partyPanel = null;
      isVisible = false;
      createPartyPanel();
    }
    if (!partyPanel) return;
    setPanelVisible(!isVisible);
    updatePanelState();
    // Refresh state (and the token's timestamp) whenever the panel opens
    if (isVisible) sendBridgeMessage({ type: "party-get-state" });
  }

  function updateButtonState() {
    updateLobbyButtonState();
  }

  function updatePanelState() {
    if (!partyPanel) return;

    const statusEl = partyPanel.querySelector(".party-status");
    const toggleBtn = document.getElementById("party-toggle-btn");
    const tokenSection = document.getElementById("party-token-section");
    const addSection = document.getElementById("party-add-section");
    const peersSection = document.getElementById("party-peers-section");
    const tokenDisplay = document.getElementById("party-token-display");
    const peerCountEl = document.getElementById("peer-count");
    const peersList = document.getElementById("peers-list");

    if (partyState.enabled) {
      if (partyState.connection === "reconnecting") {
        statusEl.className = "party-status reconnecting";
        statusEl.textContent = t("Reconnecting...");
      } else {
        statusEl.className = "party-status online";
        statusEl.textContent = t("Online");
      }

      toggleBtn.className = "party-toggle-btn disable";
      toggleBtn.textContent = t("Disable Party Mode");

      tokenSection.style.display = "block";
      addSection.style.display = "block";
      peersSection.style.display = "block";

      if (partyState.my_token) {
        tokenDisplay.value = partyState.my_token;
      }

      // Update peers list (show all peers, including those still connecting)
      const allPeers = partyState.peers || [];
      const connectedPeers = allPeers.filter((p) => p.connected);
      peerCountEl.textContent = connectedPeers.length;

      if (allPeers.length === 0) {
        peersList.innerHTML = `<div class="no-peers">${t("No friends connected yet")}</div>`;
      } else {
        peersList.innerHTML = allPeers
          .map((peer) => {
            const cs = (peer.connection_state || "disconnected").toLowerCase();
            const isWaiting = cs === "connecting" || cs === "handshaking";
            const statusText = isWaiting
              ? t("Waiting for your friend")
              : cs === "connected"
                ? (peer.in_lobby ? t("In lobby") : t("Connected"))
                : cs === "reconnecting"
                  ? t("Reconnecting...")
                  : t("Disconnected");
            const displayName = isWaiting ? escapeHtml(t("Friend")) : escapeHtml(peer.summoner_name);
            const lobbyStatus = peer.in_lobby ? "in-lobby" : "";
            const skinInfo = peer.skin_selection
              ? t("Skin: {id}", { id: peer.skin_selection.skin_id })
              : "";

            return `
            <div class="peer-item" data-summoner-id="${peer.summoner_id}">
              <div class="peer-info">
                <span class="peer-name">${displayName}</span>
                ${isWaiting ? '<span class="peer-status waiting"><span class="spinner"></span> ' : `<span class="peer-status ${lobbyStatus}">`}
                ${escapeHtml(statusText)}</span>
                ${skinInfo ? `<span class="peer-skin">${skinInfo}</span>` : ""}
              </div>
              <button class="peer-remove" title="${escapeHtml(t("Remove from your party"))}" onclick="window.rosePartyRemovePeer(${peer.summoner_id})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
          `;
          })
          .join("");
      }
    } else {
      statusEl.className = "party-status offline";
      statusEl.textContent = t("Offline");

      toggleBtn.className = "party-toggle-btn enable";
      toggleBtn.textContent = t("Enable Party Mode");

      tokenSection.style.display = "none";
      addSection.style.display = "none";
      peersSection.style.display = "none";
    }

    updateButtonState();
  }

  async function handleToggleParty() {
    const toggleBtn = document.getElementById("party-toggle-btn");

    if (partyState.enabled) {
      // Disable
      toggleBtn.disabled = true;
      toggleBtn.innerHTML = `<span class="spinner"></span> ${t("Disabling...")}`;
      sendBridgeMessage({ type: "party-disable" });
    } else {
      // Enable
      toggleBtn.disabled = true;
      toggleBtn.innerHTML = `<span class="spinner"></span> ${t("Enabling...")}`;
      sendBridgeMessage({ type: "party-enable" });
    }
  }

  function handleCopyToken() {
    const tokenDisplay = document.getElementById("party-token-display");
    const copyBtn = document.getElementById("copy-token-btn");

    if (!tokenDisplay.value) return;

    navigator.clipboard.writeText(tokenDisplay.value).then(() => {
      copyBtn.textContent = t("Copied!");
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = t("Copy");
        copyBtn.classList.remove("copied");
      }, 2000);
    });
  }

  function handleAddPeer() {
    const input = document.getElementById("add-peer-input");
    const addBtn = document.getElementById("add-peer-btn");
    const messageEl = document.getElementById("add-peer-message");
    // Strip and remove all whitespace (spaces, newlines, tabs) so pasted tokens work
    const token = input.value.replace(/\s+/g, "").trim();

    if (!token) {
      messageEl.innerHTML =
        `<div class="error-msg">${t("Please enter a token")}</div>`;
      return;
    }

    // Lock the entire panel during connection
    input.disabled = true;
    addBtn.disabled = true;
    addBtn.innerHTML = '<span class="spinner"></span>';
    const toggleBtn = document.getElementById("party-toggle-btn");
    if (toggleBtn) toggleBtn.disabled = true;
    setPanelLocked(true);
    messageEl.innerHTML =
      `<div class="success-msg"><span class="spinner"></span> ${t("Connecting to your friend...")}</div>`;
    sendBridgeMessage({ type: "party-add-peer", token: token });
    input.value = "";
  }

  // Global function for remove button onclick
  window.rosePartyRemovePeer = function (summonerId) {
    sendBridgeMessage({ type: "party-remove-peer", summoner_id: summonerId });
  };

  function handleBridgeMessage(data) {
    console.log(`${LOG_PREFIX} Received:`, data.type);

    switch (data.type) {
      case "party-state":
        partyState = {
          enabled: data.enabled || false,
          connection: data.connection || "offline",
          my_token: data.my_token || null,
          my_summoner_id: data.my_summoner_id || null,
          my_summoner_name: data.my_summoner_name || "Unknown",
          peers: data.peers || [],
        };
        updateButtonState();
        updatePanelState();
        break;

      case "party-enabled":
        const toggleBtn = document.getElementById("party-toggle-btn");
        if (toggleBtn) toggleBtn.disabled = false;
        // Shown under the toggle: the add-friend section is hidden while disabled
        const toggleMessageEl = document.getElementById("party-toggle-message");

        if (data.success) {
          partyState.enabled = true;
          partyState.connection = "online";
          partyState.my_token = data.token;
          if (toggleMessageEl) toggleMessageEl.innerHTML = "";
          console.log(`${LOG_PREFIX} Party mode enabled`);
        } else {
          if (toggleMessageEl) {
            toggleMessageEl.innerHTML = `<div class="error-msg">${escapeHtml(data.error ? tMessage(data.error, data.errorTemplate, data.errorValues) : t("Failed to enable"))}</div>`;
          }
          console.error(`${LOG_PREFIX} Failed to enable:`, data.error);
        }
        updateButtonState();
        updatePanelState();
        break;

      case "party-disabled":
        const toggleBtnDisable = document.getElementById("party-toggle-btn");
        if (toggleBtnDisable) toggleBtnDisable.disabled = false;

        partyState.enabled = false;
        partyState.connection = "offline";
        partyState.my_token = null;
        partyState.peers = [];
        console.log(`${LOG_PREFIX} Party mode disabled`);
        updateButtonState();
        updatePanelState();
        break;

      case "party-peer-added": {
        const addInput = document.getElementById("add-peer-input");
        const addBtn = document.getElementById("add-peer-btn");
        const addMessageEl = document.getElementById("add-peer-message");

        // Unlock the panel
        if (addInput) addInput.disabled = false;
        if (addBtn) {
          addBtn.disabled = false;
          addBtn.textContent = t("Add");
        }
        const unlockToggleBtn = document.getElementById("party-toggle-btn");
        if (unlockToggleBtn) unlockToggleBtn.disabled = false;
        setPanelLocked(false);

        if (data.success) {
          if (addMessageEl) {
            addMessageEl.innerHTML =
              `<div class="success-msg">${escapeHtml(data.message ? tMessage(data.message, data.messageTemplate, data.messageValues) : t("Friend connected!"))}</div>`;
            setTimeout(() => {
              addMessageEl.innerHTML = "";
            }, 6000);
          }
        } else {
          if (addMessageEl) {
            addMessageEl.innerHTML = `<div class="error-msg">${escapeHtml(data.error ? tMessage(data.error, data.errorTemplate, data.errorValues) : t("Failed to connect"))}</div>`;
          }
        }
        // Request updated state
        sendBridgeMessage({ type: "party-get-state" });
        break;
      }

      case "party-peer-removed":
        // Request updated state
        sendBridgeMessage({ type: "party-get-state" });
        break;

      case "phase-change":
        // Pause the 500ms DOM monitor during in-game to avoid stealing
        // CPU from the League game process.  Resume in every other phase
        // so the party button reattaches if the client re-renders.
        if (data.phase === "InProgress") {
          stopGamePhaseMonitor();
        } else {
          startGamePhaseMonitor();
        }
        break;
    }
  }

  function connectBridge() {
    if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
      return;
    }

    console.log(`${LOG_PREFIX} Connecting to bridge at ${BRIDGE_URL}`);
    bridgeSocket = new WebSocket(BRIDGE_URL);

    bridgeSocket.onopen = () => {
      console.log(`${LOG_PREFIX} Bridge connected`);
      bridgeReady = true;

      // Flush queued messages
      while (bridgeQueue.length > 0) {
        const msg = bridgeQueue.shift();
        bridgeSocket.send(JSON.stringify(msg));
      }

      // Request current party state
      sendBridgeMessage({ type: "party-get-state" });
    };

    bridgeSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleBridgeMessage(data);
      } catch (e) {
        console.error(`${LOG_PREFIX} Error parsing message:`, e);
      }
    };

    bridgeSocket.onclose = () => {
      console.log(`${LOG_PREFIX} Bridge disconnected, reconnecting...`);
      bridgeReady = false;
      setTimeout(connectBridge, 1000);
    };

    bridgeSocket.onerror = (error) => {
      console.error(`${LOG_PREFIX} Bridge error:`, error);
    };
  }

  function sendBridgeMessage(msg) {
    if (bridgeReady && bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
      bridgeSocket.send(JSON.stringify(msg));
    } else {
      bridgeQueue.push(msg);
    }
  }

  // Check if we're in lobby (pre-game party lobby)
  function isInLobby() {
    return !!(
      document.querySelector(".v2-banner-component.local-player") ||
      document.querySelector(".lobby-player.local-player") ||
      document.querySelector("lol-regalia-parties-v2-element") ||
      document.querySelector(".parties-game-info-panel") ||
      document.querySelector(".lobby-members-container") ||
      document.querySelector(".ready-check-swap-button") ||
      document.querySelector(".lobby-header-custom-map-name")
    );
  }

  // Check if we're in champion select
  function isInChampSelect() {
    return !!(
      document.querySelector(".champion-grid") ||
      document.querySelector(".summoner-array") ||
      document.querySelector(".skin-selector-dropdown") ||
      document.querySelector(".champion-select-container")
    );
  }

  // Check if we should show party UI (lobby OR champ select)
  function shouldShowPartyUI() {
    return isInLobby() || isInChampSelect();
  }

  // Remove all party UI elements

  // Monitor for lobby/champ select.
  // Pauses during InProgress phase to avoid stealing CPU from the game.
  // See GitHub issue #22.
  let gamePhaseMonitorId = null;

  function startGamePhaseMonitor() {
    if (gamePhaseMonitorId) return;
    gamePhaseMonitorId = setInterval(() => {
      const inChampSelect = isInChampSelect();
      const inLobby = isInLobby();

      // Always keep the party button in the social actions bar
      // (it's always present, not just in lobby)
      if (!lobbyButton || !lobbyButton.isConnected) {
        lobbyButton = null;
        createLobbyButton();
      }

      // Ensure panel exists
      if (!partyPanel || !partyPanel.isConnected) {
        partyPanel = null;
        isVisible = false;
        createPartyPanel();
      }

      // Track UI mode changes
      if (inChampSelect && currentUIMode !== "champselect") {
        console.log(`${LOG_PREFIX} Entered champion select`);
        currentUIMode = "champselect";
        updateLobbyButtonState();
      } else if (inLobby && currentUIMode !== "lobby") {
        console.log(`${LOG_PREFIX} Entered lobby`);
        currentUIMode = "lobby";
        updateLobbyButtonState();
      } else if (!inChampSelect && !inLobby && currentUIMode !== "default") {
        currentUIMode = "default";
        updateLobbyButtonState();
      }

      // Update 403Changer connected badges on lobby members
      updateLobbyMemberBadges();
    }, 500);
  }

  // ---- 403Changer icon next to the names of lobby players who run it ----
  //
  // Who runs it is known from party mode: everyone in the lobby with the app open
  // joins the lobby's room. Each lobby card carries its player's summoner id, which
  // picks the card; the name inside it is then found by its text, because where the
  // client puts the name (which element, which shadow root) is its own business and
  // changes between patches.
  const nameIcons = new Map(); // summoner id -> the icon we placed
  const nameIconMisses = new Map(); // summoner id -> passes without finding the name
  let nameIconReported = "";

  function normalizeName(text) {
    return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  // Every player known to run 403Changer in this lobby: id -> displayed name.
  function changerUsers() {
    const users = new Map();
    if (!partyState.enabled) return users;
    if (partyState.my_summoner_id && partyState.my_summoner_name) {
      users.set(String(partyState.my_summoner_id), partyState.my_summoner_name);
    }
    for (const peer of partyState.peers || []) {
      if (peer.connected && peer.summoner_id && peer.summoner_name) {
        users.set(String(peer.summoner_id), peer.summoner_name);
      }
    }
    return users;
  }

  // All elements under root, going into open shadow roots as well.
  function* elementsDeep(root) {
    const walker = (root.ownerDocument || document).createTreeWalker(root, 1 /* SHOW_ELEMENT */);
    let node = walker.currentNode === root && root.nodeType === 1 ? root : walker.nextNode();
    while (node) {
      yield node;
      if (node.shadowRoot) yield* elementsDeep(node.shadowRoot);
      node = walker.nextNode();
    }
  }

  // The innermost element showing exactly this name (or the name and a short tag).
  function findNameElement(scope, name) {
    const target = normalizeName(name);
    if (!target) return null;
    let exact = null;
    let loose = null;
    for (const el of elementsDeep(scope)) {
      if (el.classList && el.classList.contains("changer-name-icon")) continue;
      const text = normalizeName(el.textContent);
      if (!text) continue;
      if (text === target) exact = el; // later matches are deeper: keep the last
      else if (!exact && text.startsWith(target) && text.length <= target.length + 8) loose = el;
    }
    return exact || loose;
  }

  // The name may sit beside the element carrying the id rather than inside it, so
  // widen the search one ancestor at a time, never into a container shared by
  // several players.
  function findNameForCard(idElement, name) {
    let scope = idElement;
    for (let depth = 0; depth < 6 && scope; depth++) {
      if (depth && scope.querySelectorAll("[summoner-id]").length > 1) break;
      const found = findNameElement(scope, name);
      if (found) return found;
      scope = scope.parentElement;
    }
    return null;
  }

  function createNameIcon() {
    const icon = document.createElement("img");
    icon.className = "changer-name-icon";
    icon.src = `http://127.0.0.1:${BRIDGE_PORT}/asset/icon.png`;
    icon.alt = "403";
    icon.title = "403Changer";
    // Inline, since a stylesheet in the page does not reach into a shadow root
    icon.style.cssText =
      "display:inline-block;width:14px;height:14px;margin-left:5px;border-radius:3px;" +
      "vertical-align:middle;flex:none;pointer-events:auto;";
    return icon;
  }

  // A short outline of what the card is made of, for the log when the name is not found.
  function describeCard(idElement) {
    const scope = idElement.closest(".v2-banner-component") || idElement.parentElement || idElement;
    const parts = [];
    for (const el of elementsDeep(scope)) {
      if (parts.length >= 60) break;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
      const classes = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : "";
      parts.push(el.tagName.toLowerCase() + classes + (own ? `="${own.slice(0, 24)}"` : ""));
    }
    return parts.join(" > ").slice(0, 1800);
  }

  function reportNameIcons(message) {
    if (message === nameIconReported) return;
    nameIconReported = message;
    sendBridgeMessage({ type: "chroma-log", source: "PartyMode", level: "info", message, timestamp: Date.now() });
  }

  function updateLobbyMemberBadges() {
    const users = isInLobby() ? changerUsers() : new Map();

    for (const [id, icon] of nameIcons) {
      if (!users.has(id) || !icon.isConnected) {
        icon.remove();
        nameIcons.delete(id);
      }
    }
    if (!users.size) {
      nameIconMisses.clear();
      return;
    }

    document.querySelectorAll("lol-regalia-parties-v2-element[summoner-id]").forEach((idElement) => {
      const id = String(idElement.getAttribute("summoner-id"));
      if (!users.has(id) || nameIcons.has(id)) return;

      const nameElement = findNameForCard(idElement, users.get(id));
      if (!nameElement) {
        // Cards fill in a moment after they appear: only call it missing after a while
        const misses = (nameIconMisses.get(id) || 0) + 1;
        nameIconMisses.set(id, misses);
        if (misses === 8) {
          reportNameIcons(`name not found on the lobby card of "${users.get(id)}": ${describeCard(idElement)}`);
        }
        return;
      }
      const icon = createNameIcon();
      nameElement.appendChild(icon);
      nameIcons.set(id, icon);
      nameIconMisses.delete(id);
      reportNameIcons(`icon placed next to ${nameIcons.size} name(s) in the lobby, on <${nameElement.tagName.toLowerCase()} class="${nameElement.className || ""}">`);
    });
  }

  function stopGamePhaseMonitor() {
    if (!gamePhaseMonitorId) return;
    clearInterval(gamePhaseMonitorId);
    gamePhaseMonitorId = null;
  }

  // Initialize
  async function init() {
    console.log(`${LOG_PREFIX} Initializing...`);

    await loadBridgePort();
    injectStyles();
    connectBridge();

    // Always create social bar button and panel
    createLobbyButton();
    createPartyPanel();

    // Set initial UI mode
    if (isInChampSelect()) {
      currentUIMode = "champselect";
    } else if (isInLobby()) {
      currentUIMode = "lobby";
    } else {
      currentUIMode = "default";
    }

    startGamePhaseMonitor();

    console.log(`${LOG_PREFIX} Initialized`);
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
