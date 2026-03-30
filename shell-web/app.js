/**
 * app.js - Monet Shell Web App
 *
 * Full-featured agent-native OS shell. Handles:
 * - Intent submission and routing
 * - Named SSE event streaming (thinking, text, tool_call, tool_result, done, error,
 *   approval_required, approval_resolved)
 * - Four UI patterns: chat, tinder, diff, whiteboard
 * - Approval modal for action gating
 * - Agent monitor panel
 * - Session history
 * - Whiteboard: draggable nodes, pan/zoom, SVG connections
 *
 * Backend: http://localhost:8420
 *   POST /intent { text } -> { session_id, agent, ui_pattern }
 *   GET  /stream/{session_id} -> SSE (named events)
 *   POST /approve/{session_id}/{action_id}
 *   POST /reject/{session_id}/{action_id}
 *   GET  /status -> { status, model, active_sessions, total_sessions }
 */

"use strict";

/* =========================================================
   Constants
   ========================================================= */

var BACKEND = "http://localhost:8420";
var HEALTH_INTERVAL_MS = 6000;

/** All SSE event type names the backend emits */
var SSE_EVENT_TYPES = [
  "thinking", "text", "tool_call", "tool_result",
  "done", "error", "approval_required", "approval_resolved"
];

/* =========================================================
   State
   ========================================================= */

var state = {
  currentPattern:       "welcome",
  isStreaming:          false,
  currentEventSource:   null,
  currentSessionId:     null,
  currentAgentMsgEl:    null,  /* active streaming message bubble in chat */
  thinkingEl:           null,  /* thinking indicator row in chat */
  sessions:             [],    /* history: [{ id, agent, pattern, intent, messages, status, start }] */
  pendingApproval:      null,  /* { action_id, session_id } */
  /* Whiteboard state */
  wb: {
    nodes:          [],    /* [{ id, x, y, el, title, body }] */
    connections:    [],    /* [{ from, to }] */
    panX:           0,
    panY:           0,
    scale:          1,
    draggingNode:   null,  /* { node, startX, startY, origX, origY } */
    isPanning:      false,
    panStart:       null,
  },
  /* Tinder queue */
  tinder: {
    queue:    [],          /* pending card data */
    current:  null,
    index:    0,
    total:    0,
  },
};

/* =========================================================
   DOM references
   ========================================================= */

var $ = function(id) { return document.getElementById(id); };

var dom = {
  connDot:           $("conn-dot"),
  connLabel:         $("conn-label"),
  agentPills:        $("agent-pills"),
  newSessionBtn:     $("new-session-btn"),
  mainContent:       $("main-content"),
  intentInput:       $("intent-input"),
  intentSend:        $("intent-send"),
  /* Chat */
  chatMessages:      $("chat-messages"),
  /* Tinder */
  tinderCounter:     $("tinder-counter"),
  tinderCard:        $("tinder-card"),
  tinderCardTitle:   $("tinder-card-title"),
  tinderCardBody:    $("tinder-card-body"),
  tinderApprove:     $("tinder-approve"),
  tinderReject:      $("tinder-reject"),
  /* Diff */
  diffOriginal:      $("diff-original"),
  diffProposed:      $("diff-proposed"),
  diffApproveAll:    $("diff-approve-all"),
  diffRejectAll:     $("diff-reject-all"),
  /* Whiteboard */
  wbCanvas:          $("whiteboard-canvas"),
  wbNodes:           $("whiteboard-nodes"),
  wbConnections:     $("whiteboard-connections"),
  /* Approval */
  approvalOverlay:   $("approval-overlay"),
  approvalToolName:  $("approval-tool-name"),
  approvalDesc:      $("approval-description"),
  approvalApprove:   $("approval-approve-btn"),
  approvalReject:    $("approval-reject-btn"),
  /* Monitor */
  monitorPanel:      $("monitor-panel"),
  monitorList:       $("monitor-list"),
  monitorClose:      $("monitor-close"),
};

/* =========================================================
   Pattern switching
   ========================================================= */

/**
 * Show the specified UI pattern view, hiding all others.
 * Also updates state.currentPattern.
 *
 * @param {string} pattern - "welcome" | "chat" | "tinder" | "diff" | "whiteboard"
 */
function showPattern(pattern) {
  state.currentPattern = pattern;

  var views = dom.mainContent.querySelectorAll(".pattern-view");
  views.forEach(function(v) { v.classList.remove("active"); });

  var id = pattern === "welcome" ? "welcome-screen" : pattern + "-view";
  var target = document.getElementById(id);
  if (target) {
    target.classList.add("active");
  } else {
    document.getElementById("chat-view").classList.add("active");
    state.currentPattern = "chat";
  }
}

/* =========================================================
   Status / health
   ========================================================= */

/**
 * Poll the backend /status endpoint and update the connection dot.
 */
function checkHealth() {
  fetch(BACKEND + "/status", { method: "GET", cache: "no-store" })
    .then(function(res) { setConnected(res.ok); })
    .catch(function()   { setConnected(false); });
}

/**
 * Set the connected/disconnected visual state.
 *
 * @param {boolean} connected
 */
function setConnected(connected) {
  if (connected) {
    dom.connDot.classList.add("connected");
    dom.connLabel.textContent = "Connected";
  } else {
    dom.connDot.classList.remove("connected");
    dom.connLabel.textContent = "Offline";
  }
}

/* =========================================================
   Session management
   ========================================================= */

/**
 * Create a new session record and push it to the history.
 *
 * @param {string} sessionId
 * @param {string} agent
 * @param {string} pattern
 * @param {string} intent
 * @returns {object} The new session object
 */
function createSession(sessionId, agent, pattern, intent) {
  var session = {
    id:       sessionId,
    agent:    agent || "Agent",
    pattern:  pattern,
    intent:   intent,
    messages: [],
    status:   "running",
    start:    Date.now(),
    lastText: "",
  };
  state.sessions.push(session);
  state.currentSessionId = sessionId;
  refreshMonitorList();
  refreshAgentPills();
  return session;
}

/**
 * Get the current session by ID, or null.
 *
 * @returns {object|null}
 */
function currentSession() {
  if (!state.currentSessionId) return null;
  for (var i = 0; i < state.sessions.length; i++) {
    if (state.sessions[i].id === state.currentSessionId) return state.sessions[i];
  }
  return null;
}

/**
 * Mark the current session done or errored, then refresh the UI.
 *
 * @param {"done"|"error"} status
 */
function finalizeSession(status) {
  var session = currentSession();
  if (session) {
    session.status = status;
    session.duration = Math.round((Date.now() - session.start) / 1000);
  }
  refreshMonitorList();
  refreshAgentPills();
}

/**
 * Reset to the welcome screen, closing any open stream.
 */
function resetToWelcome() {
  closeStream();
  state.currentAgentMsgEl = null;
  state.thinkingEl = null;
  state.tinder.queue = [];
  state.tinder.current = null;
  state.tinder.index = 0;
  state.tinder.total = 0;
  /* Clear diff */
  dom.diffOriginal.innerHTML = "";
  dom.diffProposed.innerHTML = "";
  /* Clear whiteboard */
  resetWhiteboard();
  showPattern("welcome");
}

/* =========================================================
   Agent pills (top bar)
   ========================================================= */

/**
 * Re-render the agent status pills in the top bar.
 * Only shows sessions from the last 30 seconds that are running,
 * plus any currently active session.
 */
function refreshAgentPills() {
  dom.agentPills.innerHTML = "";
  var now = Date.now();
  state.sessions.forEach(function(s) {
    var age = (now - s.start) / 1000;
    if (s.status === "running" || (s.id === state.currentSessionId && age < 8)) {
      var pill = document.createElement("div");
      pill.className = "agent-pill";
      var dot = document.createElement("span");
      dot.className = "agent-pill-dot " + s.status;
      var label = document.createElement("span");
      label.textContent = s.agent + " - " + s.status;
      pill.appendChild(dot);
      pill.appendChild(label);
      dom.agentPills.appendChild(pill);
    }
  });
}

/* =========================================================
   Monitor panel
   ========================================================= */

/**
 * Re-render the list of sessions in the monitor panel.
 */
function refreshMonitorList() {
  dom.monitorList.innerHTML = "";
  if (state.sessions.length === 0) {
    var empty = document.createElement("div");
    empty.style.cssText = "padding:24px 12px;text-align:center;color:var(--text-muted);font-size:12px;";
    empty.textContent = "No sessions yet";
    dom.monitorList.appendChild(empty);
    return;
  }

  /* Show newest first */
  var sorted = state.sessions.slice().reverse();
  sorted.forEach(function(s) {
    var item = document.createElement("div");
    item.className = "monitor-item" + (s.id === state.currentSessionId ? " active-item" : "");

    var header = document.createElement("div");
    header.className = "monitor-item-header";

    var dot = document.createElement("span");
    dot.className = "monitor-status-dot " + s.status;

    var name = document.createElement("span");
    name.className = "monitor-item-name";
    name.textContent = s.agent;

    var dur = document.createElement("span");
    dur.className = "monitor-item-duration";
    if (s.duration != null) {
      dur.textContent = s.duration + "s";
    } else {
      var elapsed = Math.round((Date.now() - s.start) / 1000);
      dur.textContent = elapsed + "s";
    }

    header.appendChild(dot);
    header.appendChild(name);
    header.appendChild(dur);

    var preview = document.createElement("div");
    preview.className = "monitor-item-preview";
    preview.textContent = s.lastText ? s.lastText.slice(0, 60) : s.intent;

    item.appendChild(header);
    item.appendChild(preview);
    dom.monitorList.appendChild(item);
  });
}

/* =========================================================
   Chat pattern helpers
   ========================================================= */

/**
 * Append a message row to the chat view.
 *
 * @param {"user"|"agent"|"status"} role
 * @param {string} text
 * @returns {HTMLElement} The message bubble element
 */
function appendChatMessage(role, text) {
  if (role === "status") {
    var row = document.createElement("div");
    row.className = "status-row";
    var msg = document.createElement("div");
    msg.className = "status-msg";
    msg.textContent = text || "";
    row.appendChild(msg);
    dom.chatMessages.appendChild(row);
    scrollChat();
    return msg;
  }

  var row = document.createElement("div");
  row.className = "msg-row " + role;

  var bubble = document.createElement("div");
  bubble.className = "message " + role;
  renderMessageContent(bubble, text || "");

  row.appendChild(bubble);
  dom.chatMessages.appendChild(row);
  scrollChat();
  return bubble;
}

/**
 * Render text into a message bubble with minimal markdown-like formatting.
 * Supports **bold**, line breaks, and bullet lines starting with "- " or "* ".
 *
 * @param {HTMLElement} el
 * @param {string} text
 */
function renderMessageContent(el, text) {
  el.innerHTML = "";
  if (!text) return;

  /* Split into lines first */
  var lines = text.split("\n");
  lines.forEach(function(line, idx) {
    /* Check for bullet */
    var isBullet = /^(\s*[-*])\s+/.test(line);
    if (isBullet) {
      var li = document.createElement("li");
      li.style.marginLeft = "4px";
      applyInlineMarkdown(li, line.replace(/^(\s*[-*])\s+/, ""));
      /* Wrap in ul if previous sibling is not ul */
      var last = el.lastChild;
      if (!last || last.tagName !== "UL") {
        var ul = document.createElement("ul");
        ul.appendChild(li);
        el.appendChild(ul);
      } else {
        last.appendChild(li);
      }
    } else {
      var span = document.createElement("span");
      applyInlineMarkdown(span, line);
      el.appendChild(span);
    }
    /* Line break between non-last lines */
    if (idx < lines.length - 1) {
      el.appendChild(document.createElement("br"));
    }
  });
}

/**
 * Apply inline markdown (**bold**) to an element by setting its innerHTML.
 * Only processes bold markers to avoid XSS through agent text.
 *
 * @param {HTMLElement} el
 * @param {string} text
 */
function applyInlineMarkdown(el, text) {
  /* Escape HTML first, then re-introduce bold */
  var escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  var bolded = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  el.innerHTML = bolded;
}

/** Scroll chat to the very bottom. */
function scrollChat() {
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

/**
 * Show or update the animated thinking indicator in chat.
 * Creates it on first call, no-ops if already showing.
 */
function showThinking() {
  if (state.thinkingEl) return;
  var row = document.createElement("div");
  row.className = "thinking-row";
  var dots = document.createElement("div");
  dots.className = "thinking-dots";
  for (var i = 0; i < 3; i++) {
    var s = document.createElement("span");
    dots.appendChild(s);
  }
  row.appendChild(dots);
  dom.chatMessages.appendChild(row);
  state.thinkingEl = row;
  scrollChat();
}

/** Remove the thinking indicator from the DOM. */
function hideThinking() {
  if (state.thinkingEl) {
    state.thinkingEl.remove();
    state.thinkingEl = null;
  }
}

/**
 * Append a text chunk to the current streaming agent message bubble.
 * Creates a new bubble if none exists. Adds the blinking cursor class.
 *
 * @param {string} chunk
 */
function appendToAgentMessage(chunk) {
  hideThinking();
  if (!state.currentAgentMsgEl) {
    state.currentAgentMsgEl = appendChatMessage("agent", "");
    state.currentAgentMsgEl.classList.add("streaming");
  }
  /* Accumulate raw text on the element for re-rendering */
  state.currentAgentMsgEl._rawText = (state.currentAgentMsgEl._rawText || "") + chunk;
  renderMessageContent(state.currentAgentMsgEl, state.currentAgentMsgEl._rawText);
  state.currentAgentMsgEl.classList.add("streaming");

  /* Track in session */
  var session = currentSession();
  if (session) {
    session.lastText = state.currentAgentMsgEl._rawText;
  }
  scrollChat();
}

/** Finalize the current streaming bubble (remove cursor class). */
function finalizeAgentMessage() {
  if (state.currentAgentMsgEl) {
    state.currentAgentMsgEl.classList.remove("streaming");
    state.currentAgentMsgEl = null;
  }
}

/**
 * Append a tool call badge to the chat messages.
 *
 * @param {string} toolName
 * @param {object} toolInput
 */
function appendToolCallBadge(toolName, toolInput) {
  hideThinking();
  finalizeAgentMessage();

  var row = document.createElement("div");
  row.className = "tool-badge-row";

  var badge = document.createElement("div");
  badge.className = "tool-badge";

  /* Gear icon */
  badge.innerHTML =
    '<svg class="tool-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
    '</svg>';

  var label = document.createElement("span");
  label.textContent = toolName;
  badge.appendChild(label);

  row.appendChild(badge);
  dom.chatMessages.appendChild(row);
  scrollChat();
}

/**
 * Append a tool result indicator to the chat messages.
 *
 * @param {string} toolName
 * @param {*} result
 */
function appendToolResultBadge(toolName, result) {
  var row = document.createElement("div");
  row.className = "tool-result-row";

  var badge = document.createElement("div");
  badge.className = "tool-result-badge";
  badge.textContent = "\u2713 " + toolName + " returned";

  row.appendChild(badge);
  dom.chatMessages.appendChild(row);
  scrollChat();
}

/* =========================================================
   Tinder pattern
   ========================================================= */

/**
 * Enqueue a new card item for the tinder pattern.
 * If no card is currently shown, show it immediately.
 *
 * @param {object} data - { title, body } or raw text
 */
function enqueueTinderCard(data) {
  state.tinder.queue.push(data);
  state.tinder.total = Math.max(state.tinder.total, state.tinder.queue.length + state.tinder.index);
  if (!state.tinder.current) {
    showNextTinderCard();
  }
}

/**
 * Dequeue and display the next card in the tinder queue.
 */
function showNextTinderCard() {
  if (state.tinder.queue.length === 0) {
    state.tinder.current = null;
    dom.tinderCounter.textContent = "All done";
    return;
  }

  var card = state.tinder.queue.shift();
  state.tinder.current = card;
  state.tinder.index++;

  dom.tinderCardTitle.textContent = card.title || "";
  renderMessageContent(dom.tinderCardBody, card.body || card.text || "");

  var total = state.tinder.total || "?";
  dom.tinderCounter.textContent = state.tinder.index + " of " + total;

  /* Reset any exit animation classes */
  dom.tinderCard.classList.remove("exit-left", "exit-right");
}

/**
 * Animate the tinder card out and show the next one.
 * Called by approve/reject button handlers.
 *
 * @param {"left"|"right"} direction
 * @param {string} sessionId
 * @param {string|null} actionId
 * @param {boolean} approved
 */
function dismissTinderCard(direction, sessionId, actionId, approved) {
  dom.tinderCard.classList.add(direction === "right" ? "exit-right" : "exit-left");

  if (actionId && sessionId) {
    var endpoint = approved ? "/approve/" : "/reject/";
    fetch(BACKEND + endpoint + encodeURIComponent(sessionId) + "/" + encodeURIComponent(actionId), {
      method: "POST",
    }).catch(function(e) { console.warn("tinder action error:", e); });
  }

  setTimeout(function() {
    showNextTinderCard();
  }, 360);
}

/* =========================================================
   Diff pattern
   ========================================================= */

/**
 * Parse raw text into diff lines and render them into both panels.
 * Expects unified diff format, or plain text in proposed panel.
 *
 * @param {string} text - raw diff or text chunk
 */
function appendDiffContent(text) {
  /* Try to detect unified diff format */
  var lines = text.split("\n");
  lines.forEach(function(line, idx) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
      /* Skip diff header lines from display */
      return;
    }
    var lineNum = idx + 1;
    if (line.startsWith("+")) {
      appendDiffLine(dom.diffProposed, line.slice(1), lineNum, "added");
    } else if (line.startsWith("-")) {
      appendDiffLine(dom.diffOriginal, line.slice(1), lineNum, "removed");
    } else {
      /* Context line - show in both */
      appendDiffLine(dom.diffOriginal, line.startsWith(" ") ? line.slice(1) : line, lineNum, "");
      appendDiffLine(dom.diffProposed, line.startsWith(" ") ? line.slice(1) : line, lineNum, "");
    }
  });
  syncDiffScroll();
}

/**
 * Append a single line to a diff panel body.
 *
 * @param {HTMLElement} panel
 * @param {string} content
 * @param {number} lineNum
 * @param {string} type - "added" | "removed" | ""
 */
function appendDiffLine(panel, content, lineNum, type) {
  var row = document.createElement("div");
  row.className = "diff-line" + (type ? " " + type : "");

  var num = document.createElement("span");
  num.className = "diff-line-num";
  num.textContent = lineNum;

  var text = document.createElement("span");
  text.className = "diff-line-content";
  text.textContent = content;

  row.appendChild(num);
  row.appendChild(text);
  panel.appendChild(row);
}

/** Sync scroll position of both diff panels. */
function syncDiffScroll() {
  var orig = dom.diffOriginal;
  var prop = dom.diffProposed;
  var ratio = orig.scrollHeight > orig.clientHeight
    ? orig.scrollTop / (orig.scrollHeight - orig.clientHeight) : 0;
  prop.scrollTop = ratio * (prop.scrollHeight - prop.clientHeight);
}

/* =========================================================
   Whiteboard pattern
   ========================================================= */

/**
 * Reset whiteboard to an empty state.
 */
function resetWhiteboard() {
  state.wb.nodes = [];
  state.wb.connections = [];
  state.wb.panX = 0;
  state.wb.panY = 0;
  state.wb.scale = 1;
  state.wb.draggingNode = null;
  state.wb.isPanning = false;
  dom.wbNodes.innerHTML = "";
  dom.wbConnections.innerHTML = "";
  applyWbTransform();
}

/**
 * Apply the current pan/scale transform to the whiteboard node container.
 */
function applyWbTransform() {
  dom.wbNodes.style.transform =
    "translate(" + state.wb.panX + "px," + state.wb.panY + "px) scale(" + state.wb.scale + ")";
  dom.wbNodes.style.transformOrigin = "0 0";
  redrawConnections();
}

/**
 * Add a node to the whiteboard at the given position, or auto-position it.
 *
 * @param {object} opts - { title, body, x, y }
 * @returns {object} The node record
 */
function addWhiteboardNode(opts) {
  var id = "wbn-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  var count = state.wb.nodes.length;

  /* Auto-layout: arrange in a flowing grid */
  var cols = 3;
  var col = count % cols;
  var row = Math.floor(count / cols);
  var x = opts.x != null ? opts.x : 60 + col * 360;
  var y = opts.y != null ? opts.y : 60 + row * 200;

  var el = document.createElement("div");
  el.className = "wb-node";
  el.style.left = x + "px";
  el.style.top  = y + "px";

  var titleEl = document.createElement("div");
  titleEl.className = "wb-node-title";
  titleEl.textContent = opts.title || "";

  var bodyEl = document.createElement("div");
  bodyEl.className = "wb-node-body";
  bodyEl.textContent = opts.body || "";

  if (opts.title) el.appendChild(titleEl);
  el.appendChild(bodyEl);
  dom.wbNodes.appendChild(el);

  var node = { id: id, x: x, y: y, el: el };
  state.wb.nodes.push(node);

  /* Connect to previous node if any */
  if (state.wb.nodes.length > 1) {
    var prev = state.wb.nodes[state.wb.nodes.length - 2];
    state.wb.connections.push({ from: prev.id, to: id });
    redrawConnections();
  }

  setupNodeDrag(node);
  return node;
}

/**
 * Set up drag-to-move behavior on a whiteboard node.
 *
 * @param {object} node - The node record with .el, .x, .y
 */
function setupNodeDrag(node) {
  var el = node.el;
  el.addEventListener("mousedown", function(e) {
    e.stopPropagation();
    state.wb.draggingNode = {
      node: node,
      startX: e.clientX,
      startY: e.clientY,
      origX: node.x,
      origY: node.y,
    };
  });
}

/**
 * Redraw all SVG connection lines between whiteboard nodes.
 */
function redrawConnections() {
  dom.wbConnections.innerHTML = "";
  state.wb.connections.forEach(function(conn) {
    var fromNode = state.wb.nodes.find(function(n) { return n.id === conn.from; });
    var toNode   = state.wb.nodes.find(function(n) { return n.id === conn.to; });
    if (!fromNode || !toNode) return;

    var fw = fromNode.el.offsetWidth  || 180;
    var fh = fromNode.el.offsetHeight || 80;
    var tw = toNode.el.offsetWidth    || 180;

    /* Center-right of from to center-left of to */
    var x1 = fromNode.x + fw + state.wb.panX;
    var y1 = fromNode.y + fh / 2 + state.wb.panY;
    var x2 = toNode.x + state.wb.panX;
    var y2 = toNode.y + fh / 2 + state.wb.panY;

    /* Cubic bezier */
    var cx = (x1 + x2) / 2;
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M " + x1 + " " + y1 + " C " + cx + " " + y1 + " " + cx + " " + y2 + " " + x2 + " " + y2);
    path.setAttribute("stroke", "rgba(255,255,255,0.08)");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("fill", "none");
    dom.wbConnections.appendChild(path);
  });
}

/* =========================================================
   Stream content dispatch
   ========================================================= */

/**
 * Route incoming text content to the active pattern renderer.
 *
 * @param {string} chunk
 */
function appendStreamText(chunk) {
  switch (state.currentPattern) {
    case "chat":
      appendToAgentMessage(chunk);
      break;
    case "tinder":
      /* In tinder mode, accumulate text and add as a card when done */
      state._tinderBuffer = (state._tinderBuffer || "") + chunk;
      /* Show buffered text in current card body while streaming */
      renderMessageContent(dom.tinderCardBody, state._tinderBuffer);
      break;
    case "diff":
      appendDiffContent(chunk);
      break;
    case "whiteboard":
      /* Accumulate and parse nodes from JSON-ish text */
      state._wbBuffer = (state._wbBuffer || "") + chunk;
      tryParseWbBuffer();
      break;
    default:
      break;
  }
}

/**
 * Attempt to parse a JSON node object from the whiteboard text buffer.
 * Expects lines like: {"title":"...", "body":"..."}
 */
function tryParseWbBuffer() {
  var buf = state._wbBuffer || "";
  var lines = buf.split("\n");
  var remaining = "";
  lines.forEach(function(line) {
    line = line.trim();
    if (!line) return;
    try {
      var obj = JSON.parse(line);
      addWhiteboardNode({ title: obj.title || "", body: obj.body || obj.content || obj.text || "" });
    } catch (e) {
      /* Not valid JSON yet - keep as remaining */
      remaining += line + "\n";
    }
  });
  state._wbBuffer = remaining;
}

/**
 * Clear pattern-specific buffers and content for a fresh session.
 *
 * @param {string} pattern
 */
function clearPatternContent(pattern) {
  state._tinderBuffer = "";
  state._wbBuffer = "";
  state.currentAgentMsgEl = null;
  state.thinkingEl = null;

  switch (pattern) {
    case "chat":
      dom.chatMessages.innerHTML = "";
      break;
    case "tinder":
      state.tinder.queue = [];
      state.tinder.current = null;
      state.tinder.index = 0;
      state.tinder.total = 0;
      dom.tinderCardTitle.textContent = "";
      dom.tinderCardBody.innerHTML = "";
      dom.tinderCounter.textContent = "";
      dom.tinderCard.classList.remove("exit-left", "exit-right");
      break;
    case "diff":
      dom.diffOriginal.innerHTML = "";
      dom.diffProposed.innerHTML = "";
      break;
    case "whiteboard":
      resetWhiteboard();
      break;
    default:
      break;
  }
}

/* =========================================================
   SSE stream
   ========================================================= */

/**
 * Close any existing SSE connection and unlock the input bar.
 */
function closeStream() {
  if (state.currentEventSource) {
    state.currentEventSource.close();
    state.currentEventSource = null;
  }
  state.isStreaming = false;
  dom.intentSend.disabled = false;
  dom.intentInput.disabled = false;
}

/**
 * Open an SSE connection to the agent stream for the given session.
 * Attaches listeners for all named event types.
 *
 * @param {string} sessionId
 */
function connectStream(sessionId) {
  closeStream();
  state.isStreaming = true;
  dom.intentSend.disabled = true;
  dom.intentInput.disabled = true;

  var url = BACKEND + "/stream/" + encodeURIComponent(sessionId);
  var es = new EventSource(url);
  state.currentEventSource = es;

  function parseAndHandle(evt) {
    var data;
    try {
      data = JSON.parse(evt.data);
    } catch (err) {
      console.warn("SSE parse error:", err, evt.data);
      return;
    }
    /* Inject the SSE event name as event_type if backend doesn't set it */
    if (!data.event_type) data.event_type = evt.type;
    handleAgentEvent(data);
  }

  /* IMPORTANT: onmessage only fires for unnamed events.
     Named events require addEventListener per type. */
  es.onmessage = parseAndHandle;
  SSE_EVENT_TYPES.forEach(function(t) {
    es.addEventListener(t, parseAndHandle);
  });

  es.onerror = function() {
    if (state.isStreaming) {
      finalizeAgentMessage();
      hideThinking();
      if (state.currentPattern === "chat") {
        var row = document.createElement("div");
        row.className = "status-row";
        var msg = document.createElement("div");
        msg.className = "status-msg error";
        msg.textContent = "Connection lost";
        row.appendChild(msg);
        dom.chatMessages.appendChild(row);
        scrollChat();
      }
      finalizeSession("error");
      closeStream();
    }
  };
}

/**
 * Handle a parsed SSE event object, routing to the correct handler.
 *
 * @param {object} data - Parsed JSON from the SSE data field
 */
function handleAgentEvent(data) {
  var type = data.event_type || data.type;

  switch (type) {

    case "thinking":
      if (state.currentPattern === "chat") showThinking();
      break;

    case "text":
      appendStreamText(data.text || data.content || "");
      break;

    case "tool_call":
      if (state.currentPattern === "chat") {
        appendToolCallBadge(
          data.tool_name || data.name || "tool",
          data.tool_input || data.input || {}
        );
      }
      break;

    case "tool_result":
      if (state.currentPattern === "chat") {
        appendToolResultBadge(
          data.tool_name || data.name || "tool",
          data.tool_result || data.result || {}
        );
      }
      break;

    case "approval_required":
      showApprovalModal(
        data.action_id || data.id,
        data.tool_name || "action",
        data.action_description || data.description || "Proceed with this action?",
        state.currentSessionId
      );
      break;

    case "approval_resolved":
      hideApprovalModal();
      break;

    case "done":
      handleDone();
      break;

    case "error":
      handleError(data.error || data.message || "An error occurred");
      break;

    default:
      /* Unknown event type - log and ignore */
      console.log("Unknown SSE event:", type, data);
      break;
  }
}

/**
 * Handle the "done" SSE event - finalize the UI and unlock input.
 */
function handleDone() {
  finalizeAgentMessage();
  hideThinking();
  hideApprovalModal();

  /* Finalize tinder buffer if any */
  if (state.currentPattern === "tinder" && state._tinderBuffer) {
    state.tinder.total = 1;
    showNextTinderCard();
    state._tinderBuffer = "";
  }

  /* Finalize whiteboard buffer */
  if (state.currentPattern === "whiteboard" && state._wbBuffer && state._wbBuffer.trim()) {
    addWhiteboardNode({ body: state._wbBuffer.trim() });
    state._wbBuffer = "";
  }

  finalizeSession("done");
  closeStream();
}

/**
 * Handle an "error" SSE event.
 *
 * @param {string} msg
 */
function handleError(msg) {
  finalizeAgentMessage();
  hideThinking();
  hideApprovalModal();

  if (state.currentPattern === "chat") {
    var row = document.createElement("div");
    row.className = "status-row";
    var msgEl = document.createElement("div");
    msgEl.className = "status-msg error";
    msgEl.textContent = "Error: " + msg;
    row.appendChild(msgEl);
    dom.chatMessages.appendChild(row);
    scrollChat();
  }

  finalizeSession("error");
  closeStream();
}

/* =========================================================
   Approval modal
   ========================================================= */

/**
 * Show the approval modal for a pending agent action.
 *
 * @param {string} actionId
 * @param {string} toolName
 * @param {string} description
 * @param {string} sessionId
 */
function showApprovalModal(actionId, toolName, description, sessionId) {
  state.pendingApproval = { action_id: actionId, session_id: sessionId };
  dom.approvalToolName.textContent = toolName;
  dom.approvalDesc.textContent = description;
  dom.approvalOverlay.classList.remove("hidden");
}

/** Hide the approval modal. */
function hideApprovalModal() {
  dom.approvalOverlay.classList.add("hidden");
  state.pendingApproval = null;
}

/**
 * POST an approve or reject decision for the pending action.
 *
 * @param {boolean} approved
 */
function resolveApproval(approved) {
  if (!state.pendingApproval) return;
  var a = state.pendingApproval;
  var endpoint = approved ? "/approve/" : "/reject/";
  fetch(BACKEND + endpoint + encodeURIComponent(a.session_id) + "/" + encodeURIComponent(a.action_id), {
    method: "POST",
  }).catch(function(e) { console.warn("approval error:", e); });
  hideApprovalModal();
}

/* =========================================================
   Intent submission
   ========================================================= */

/**
 * Submit the user's intent text to the backend.
 * Reads ui_pattern from the response, switches views, starts SSE stream.
 */
function submitIntent() {
  var text = dom.intentInput.value.trim();
  if (!text || state.isStreaming) return;

  dom.intentInput.value = "";

  fetch(BACKEND + "/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text }),
  })
    .then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function(body) {
      var pattern   = body.ui_pattern || "chat";
      var sessionId = body.session_id;
      var agent     = body.agent     || "Agent";

      clearPatternContent(pattern);
      showPattern(pattern);

      createSession(sessionId, agent, pattern, text);

      if (pattern === "chat") {
        appendChatMessage("user", text);
        showThinking();
      }

      if (pattern === "tinder") {
        /* Pre-set total from any hint in the response */
        state.tinder.total = body.total || 0;
      }

      connectStream(sessionId);
    })
    .catch(function(err) {
      console.error("intent error:", err);
      showPattern("chat");
      dom.chatMessages.innerHTML = "";
      appendChatMessage("user", text);
      var row = document.createElement("div");
      row.className = "status-row";
      var msg = document.createElement("div");
      msg.className = "status-msg error";
      msg.textContent = "Could not reach the agent backend. Is it running on port 8420?";
      row.appendChild(msg);
      dom.chatMessages.appendChild(row);
      dom.intentSend.disabled = false;
      dom.intentInput.disabled = false;
    });
}

/* =========================================================
   Whiteboard mouse/touch events (pan + node drag)
   ========================================================= */

dom.wbCanvas.addEventListener("mousedown", function(e) {
  if (e.target === dom.wbCanvas || e.target === dom.wbNodes) {
    state.wb.isPanning = true;
    state.wb.panStart = { x: e.clientX - state.wb.panX, y: e.clientY - state.wb.panY };
    dom.wbCanvas.classList.add("panning");
  }
});

window.addEventListener("mousemove", function(e) {
  if (state.wb.draggingNode) {
    var d = state.wb.draggingNode;
    var dx = (e.clientX - d.startX) / state.wb.scale;
    var dy = (e.clientY - d.startY) / state.wb.scale;
    d.node.x = d.origX + dx;
    d.node.y = d.origY + dy;
    d.node.el.style.left = d.node.x + "px";
    d.node.el.style.top  = d.node.y + "px";
    redrawConnections();
    return;
  }
  if (state.wb.isPanning && state.wb.panStart) {
    state.wb.panX = e.clientX - state.wb.panStart.x;
    state.wb.panY = e.clientY - state.wb.panStart.y;
    applyWbTransform();
  }
});

window.addEventListener("mouseup", function() {
  state.wb.draggingNode = null;
  state.wb.isPanning = false;
  dom.wbCanvas.classList.remove("panning");
});

dom.wbCanvas.addEventListener("wheel", function(e) {
  e.preventDefault();
  var delta = e.deltaY < 0 ? 1.08 : 0.93;
  state.wb.scale = Math.min(3, Math.max(0.3, state.wb.scale * delta));
  applyWbTransform();
}, { passive: false });

/* =========================================================
   Diff scroll sync
   ========================================================= */

dom.diffOriginal.addEventListener("scroll", function() {
  var ratio = dom.diffOriginal.scrollTop / Math.max(1, dom.diffOriginal.scrollHeight - dom.diffOriginal.clientHeight);
  dom.diffProposed.scrollTop = ratio * (dom.diffProposed.scrollHeight - dom.diffProposed.clientHeight);
});

dom.diffProposed.addEventListener("scroll", function() {
  var ratio = dom.diffProposed.scrollTop / Math.max(1, dom.diffProposed.scrollHeight - dom.diffProposed.clientHeight);
  dom.diffOriginal.scrollTop = ratio * (dom.diffOriginal.scrollHeight - dom.diffOriginal.clientHeight);
});

/* =========================================================
   Button event listeners
   ========================================================= */

/* Intent bar */
dom.intentSend.addEventListener("click", submitIntent);

dom.intentInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitIntent();
  }
  if (e.key === "Escape") {
    dom.intentInput.value = "";
  }
});

/* New session */
dom.newSessionBtn.addEventListener("click", function() {
  resetToWelcome();
});

/* Welcome suggestion chips */
document.querySelectorAll(".chip").forEach(function(chip) {
  chip.addEventListener("click", function() {
    var intent = chip.getAttribute("data-intent");
    if (intent) {
      dom.intentInput.value = intent;
      submitIntent();
    }
  });
});

/* Tinder buttons */
dom.tinderApprove.addEventListener("click", function() {
  var card = state.tinder.current;
  dismissTinderCard("right", state.currentSessionId, card && card.action_id, true);
});

dom.tinderReject.addEventListener("click", function() {
  var card = state.tinder.current;
  dismissTinderCard("left", state.currentSessionId, card && card.action_id, false);
});

/* Diff action bar */
dom.diffApproveAll.addEventListener("click", function() {
  if (state.currentSessionId) {
    fetch(BACKEND + "/approve/" + encodeURIComponent(state.currentSessionId) + "/all", { method: "POST" })
      .catch(function(e) { console.warn("diff approve error:", e); });
  }
  resetToWelcome();
});

dom.diffRejectAll.addEventListener("click", function() {
  if (state.currentSessionId) {
    fetch(BACKEND + "/reject/" + encodeURIComponent(state.currentSessionId) + "/all", { method: "POST" })
      .catch(function(e) { console.warn("diff reject error:", e); });
  }
  resetToWelcome();
});

/* Approval modal */
dom.approvalApprove.addEventListener("click", function() { resolveApproval(true); });
dom.approvalReject.addEventListener("click",  function() { resolveApproval(false); });

/* Monitor panel */
dom.monitorClose.addEventListener("click", function() {
  dom.monitorPanel.classList.add("hidden");
});

/* Click agent pills area to toggle monitor */
dom.agentPills.addEventListener("click", function() {
  refreshMonitorList();
  dom.monitorPanel.classList.toggle("hidden");
});

/* Also clicking conn-status area could show monitor */
document.getElementById("conn-status").addEventListener("click", function() {
  refreshMonitorList();
  dom.monitorPanel.classList.toggle("hidden");
});

/* =========================================================
   Boot
   ========================================================= */

/** Initialize the application on page load. */
function boot() {
  showPattern("welcome");
  checkHealth();
  setInterval(checkHealth, HEALTH_INTERVAL_MS);
  dom.intentInput.focus();
}

boot();
