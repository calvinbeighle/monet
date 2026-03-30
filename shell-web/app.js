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
 * - Friendly tool name mapping
 * - Tinder card queue with per-item approve/reject
 * - Diff parsing with syntax highlighting
 * - Whiteboard node parsing from agent text
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

/**
 * Friendly display labels for known tool names.
 * Fall back to the raw tool name if not listed here.
 */
var TOOL_LABELS = {
  gmail_list_messages:           "Reading your inbox",
  gmail_read_message:            "Reading email",
  gmail_draft_reply:             "Drafting reply",
  gmail_send_email:              "Sending email",
  gmail_search_messages:         "Searching email",
  gmail_get_message:             "Reading email",
  github_list_pull_requests:     "Fetching pull requests",
  github_get_pull_request:       "Reading PR details",
  github_create_review:          "Writing review",
  github_merge_pull_request:     "Merging PR",
  github_list_repos:             "Listing repos",
  github_get_file:               "Reading file",
  github_create_comment:         "Posting comment",
  create_outline:                "Creating outline",
  generate_questions:            "Generating questions",
  compare_options:               "Comparing options",
  search_web:                    "Searching the web",
  read_file:                     "Reading file",
  write_file:                    "Writing file",
  run_command:                   "Running command",
};

/**
 * Return a friendly label for a tool name.
 *
 * @param {string} name - Raw tool name from the backend
 * @returns {string}
 */
function toolLabel(name) {
  return TOOL_LABELS[name] || name || "Tool";
}

/* =========================================================
   State
   ========================================================= */

var state = {
  currentPattern:       "welcome",
  isStreaming:          false,
  currentEventSource:   null,
  currentSessionId:     null,
  currentAgentMsgEl:    null,   /* active streaming message bubble in chat */
  thinkingEl:           null,   /* thinking indicator row in chat */
  sessions:             [],     /* [{ id, agent, pattern, intent, messages, status, start }] */
  pendingApproval:      null,   /* { action_id, session_id } */

  /* Whiteboard state */
  wb: {
    nodes:        [],     /* [{ id, x, y, el, title, body }] */
    connections:  [],     /* [{ from, to }] */
    panX:         0,
    panY:         0,
    scale:        1,
    draggingNode: null,
    isPanning:    false,
    panStart:     null,
  },

  /* Tinder queue */
  tinder: {
    queue:   [],    /* [{ title, subtitle, body, label, cardType, action_id, draft, emailId }] */
    current: null,
    index:   0,
    total:   0,
  },

  /*
   * Map of emailId -> draft reply text for matching drafts to emails.
   * Populated when draft_reply tool results arrive.
   */
  _tinderDrafts: {},   /* { [emailId]: draftText } */

  /* Internal accumulators */
  _tinderBuffer:    "",
  _wbBuffer:        "",
  _diffBuffer:      "",
  _diffMode:        "both",   /* "original" | "proposed" | "both" */
};

/* =========================================================
   DOM references
   ========================================================= */

var $ = function(id) { return document.getElementById(id); };

var dom = {
  connDot:          $("conn-dot"),
  connLabel:        $("conn-label"),
  agentPills:       $("agent-pills"),
  newSessionBtn:    $("new-session-btn"),
  mainContent:      $("main-content"),
  intentInput:      $("intent-input"),
  intentSend:       $("intent-send"),
  /* Chat */
  chatMessages:     $("chat-messages"),
  /* Tinder */
  tinderCounter:        $("tinder-counter"),
  tinderCard:           $("tinder-card"),
  tinderCardLabel:      $("tinder-card-label"),
  tinderCardSubtitle:   $("tinder-card-subtitle"),
  tinderCardTitle:      $("tinder-card-title"),
  tinderCardBody:       $("tinder-card-body"),
  tinderReplySection:   $("tinder-reply-section"),
  tinderReplyTextarea:  $("tinder-reply-textarea"),
  tinderCommentary:     $("tinder-commentary"),
  tinderApprove:        $("tinder-approve"),
  tinderReject:         $("tinder-reject"),
  /* Diff */
  diffOriginal:     $("diff-original"),
  diffProposed:     $("diff-proposed"),
  diffApproveAll:   $("diff-approve-all"),
  diffRejectAll:    $("diff-reject-all"),
  /* Whiteboard */
  wbCanvas:         $("whiteboard-canvas"),
  wbNodes:          $("whiteboard-nodes"),
  wbConnections:    $("whiteboard-connections"),
  /* Approval */
  approvalOverlay:  $("approval-overlay"),
  approvalToolName: $("approval-tool-name"),
  approvalDesc:     $("approval-description"),
  approvalApprove:  $("approval-approve-btn"),
  approvalReject:   $("approval-reject-btn"),
  /* Monitor */
  monitorPanel:     $("monitor-panel"),
  monitorList:      $("monitor-list"),
  monitorClose:     $("monitor-close"),
};

/* =========================================================
   Pattern switching
   ========================================================= */

/**
 * Show the specified UI pattern view, hiding all others.
 * Adds a brief CSS fade-in animation on the new view.
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
 * Create a new session record and push it to history.
 *
 * @param {string} sessionId
 * @param {string} agent
 * @param {string} pattern
 * @param {string} intent
 * @returns {object}
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
 * Return the session object for the current session ID, or null.
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
 * Reset to the welcome screen, closing any open stream and clearing all buffers.
 */
function resetToWelcome() {
  closeStream();
  state.currentAgentMsgEl = null;
  state.thinkingEl = null;
  state.tinder.queue = [];
  state.tinder.current = null;
  state.tinder.index = 0;
  state.tinder.total = 0;
  state._tinderBuffer = "";
  state._tinderDrafts = {};
  state._wbBuffer = "";
  state._diffBuffer = "";
  /* Clear diff */
  dom.diffOriginal.innerHTML = "";
  dom.diffProposed.innerHTML = "";
  /* Clear whiteboard */
  resetWhiteboard();
  /* Clear chat */
  dom.chatMessages.innerHTML = "";
  showPattern("welcome");
}

/* =========================================================
   Agent pills (top bar)
   ========================================================= */

/**
 * Re-render the agent status pills in the top bar.
 * Shows running sessions and recently completed ones.
 */
function refreshAgentPills() {
  dom.agentPills.innerHTML = "";
  var now = Date.now();
  state.sessions.forEach(function(s) {
    var age = (now - s.start) / 1000;
    /* Show pill while running or for 8 seconds after completion */
    if (s.status === "running" || age < 8) {
      var pill = document.createElement("div");
      pill.className = "agent-pill";
      pill.title = "Click to view session";
      pill.style.cursor = "pointer";

      var dot = document.createElement("span");
      dot.className = "agent-pill-dot " + s.status;

      /* Show checkmark or X icon inline for done/error */
      var statusIcon = "";
      if (s.status === "done") statusIcon = " \u2713";
      else if (s.status === "error") statusIcon = " \u2717";

      var label = document.createElement("span");
      label.textContent = s.agent + statusIcon;

      pill.appendChild(dot);
      pill.appendChild(label);

      /* Clicking the pill activates that session */
      (function(session) {
        pill.addEventListener("click", function() {
          state.currentSessionId = session.id;
          refreshMonitorList();
          refreshAgentPills();
        });
      })(s);

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

    /* Clicking an item in the monitor navigates to that session's pattern */
    (function(session) {
      item.addEventListener("click", function() {
        state.currentSessionId = session.id;
        refreshMonitorList();
        refreshAgentPills();
        dom.monitorPanel.classList.add("hidden");
      });
    })(s);

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

  var lines = text.split("\n");
  lines.forEach(function(line, idx) {
    var isBullet = /^(\s*[-*])\s+/.test(line);
    if (isBullet) {
      var li = document.createElement("li");
      li.style.marginLeft = "4px";
      applyInlineMarkdown(li, line.replace(/^(\s*[-*])\s+/, ""));
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
    if (idx < lines.length - 1) {
      el.appendChild(document.createElement("br"));
    }
  });
}

/**
 * Apply inline markdown (**bold**) to an element.
 * Escapes HTML first to avoid XSS.
 *
 * @param {HTMLElement} el
 * @param {string} text
 */
function applyInlineMarkdown(el, text) {
  var escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  var bolded = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  el.innerHTML = bolded;
}

/** Scroll the chat messages container to the bottom. */
function scrollChat() {
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

/**
 * Show the animated thinking indicator in chat (three bouncing dots).
 * Creates it on first call; no-op if already visible.
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
 * Creates a new bubble if none exists.
 *
 * @param {string} chunk
 */
function appendToAgentMessage(chunk) {
  hideThinking();
  if (!state.currentAgentMsgEl) {
    state.currentAgentMsgEl = appendChatMessage("agent", "");
    state.currentAgentMsgEl.classList.add("streaming");
  }
  state.currentAgentMsgEl._rawText = (state.currentAgentMsgEl._rawText || "") + chunk;
  renderMessageContent(state.currentAgentMsgEl, state.currentAgentMsgEl._rawText);
  state.currentAgentMsgEl.classList.add("streaming");

  var session = currentSession();
  if (session) session.lastText = state.currentAgentMsgEl._rawText;
  scrollChat();
}

/** Finalize the current streaming bubble by removing the cursor class. */
function finalizeAgentMessage() {
  if (state.currentAgentMsgEl) {
    state.currentAgentMsgEl.classList.remove("streaming");
    state.currentAgentMsgEl = null;
  }
}

/**
 * Append a friendly tool call badge to the chat messages.
 * Displays a human-readable label instead of the raw tool name.
 *
 * @param {string} rawToolName - The raw tool name from the backend
 * @param {object} toolInput
 */
function appendToolCallBadge(rawToolName, toolInput) {
  hideThinking();
  finalizeAgentMessage();

  var row = document.createElement("div");
  row.className = "tool-badge-row";

  var badge = document.createElement("div");
  badge.className = "tool-badge";

  /* Spinner icon */
  badge.innerHTML =
    '<svg class="tool-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
    '</svg>';

  var label = document.createElement("span");
  label.textContent = toolLabel(rawToolName);
  badge.appendChild(label);

  row.appendChild(badge);
  dom.chatMessages.appendChild(row);
  scrollChat();
}

/**
 * Append a tool result summary badge to the chat messages.
 * Shows a short human-readable summary rather than raw JSON.
 *
 * @param {string} rawToolName - The raw tool name from the backend
 * @param {*} result - The tool result value
 */
function appendToolResultBadge(rawToolName, result) {
  var row = document.createElement("div");
  row.className = "tool-result-row";

  var badge = document.createElement("div");
  badge.className = "tool-result-badge";

  /* Build a brief summary from the result */
  var summary = buildToolResultSummary(rawToolName, result);
  badge.textContent = "\u2713 " + summary;

  row.appendChild(badge);
  dom.chatMessages.appendChild(row);
  scrollChat();
}

/**
 * Build a short human-readable summary string for a tool result.
 * Falls back to generic messages when the result shape is unknown.
 *
 * @param {string} toolName
 * @param {*} result
 * @returns {string}
 */
function buildToolResultSummary(toolName, result) {
  var friendly = toolLabel(toolName);

  if (!result) return friendly + " complete";

  /* Arrays (e.g. list of messages or PRs) */
  if (Array.isArray(result)) {
    return friendly + " - found " + result.length + " item" + (result.length === 1 ? "" : "s");
  }

  /* Objects - try to extract a useful field */
  if (typeof result === "object") {
    if (result.count != null)   return friendly + " - " + result.count + " results";
    if (result.id)              return friendly + " done (id: " + result.id + ")";
    if (result.subject)         return friendly + ": " + result.subject;
    if (result.title)           return friendly + ": " + result.title;
    if (result.message)         return friendly + ": " + result.message;
    if (result.status)          return friendly + " - " + result.status;
    return friendly + " complete";
  }

  /* String result - truncate */
  if (typeof result === "string") {
    var trimmed = result.trim().slice(0, 80);
    return friendly + " - " + (trimmed || "complete");
  }

  return friendly + " complete";
}

/**
 * Show an error message inside the active pattern view.
 * Uses a red-tinted status card in chat, or a simple tinder card for other patterns.
 *
 * @param {string} msg
 */
function showErrorInPattern(msg) {
  if (state.currentPattern === "chat") {
    var row = document.createElement("div");
    row.className = "status-row";
    var msgEl = document.createElement("div");
    msgEl.className = "status-msg error";
    msgEl.textContent = "Error: " + msg;
    row.appendChild(msgEl);
    dom.chatMessages.appendChild(row);
    scrollChat();
  } else if (state.currentPattern === "tinder") {
    dom.tinderCard.className = "";
    dom.tinderCard.style.borderColor = "var(--error)";
    dom.tinderCardLabel.textContent = "";
    dom.tinderCardLabel.className = "";
    dom.tinderCardSubtitle.textContent = "";
    dom.tinderCardTitle.textContent = "Error";
    dom.tinderCardBody.textContent = msg;
    dom.tinderReplyTextarea.value = "";
    dom.tinderCounter.textContent = "Something went wrong";
  } else if (state.currentPattern === "diff") {
    var errLine = document.createElement("div");
    errLine.style.cssText = "padding:16px;color:var(--error);font-size:13px;";
    errLine.textContent = "Error: " + msg;
    dom.diffProposed.appendChild(errLine);
  } else if (state.currentPattern === "whiteboard") {
    addWhiteboardNode({ title: "Error", body: msg });
  }
}

/* =========================================================
   Tinder pattern
   ========================================================= */

/**
 * Determine the card type ("email", "pr", "task", "item") from a raw item object.
 * Used to set the label pill style and left border color.
 *
 * @param {object} item
 * @param {string} [hint] - Optional hint from the wrapper key ("emails", "pull_requests", etc.)
 * @returns {"email"|"pr"|"task"|"item"}
 */
function inferCardType(item, hint) {
  if (hint === "emails" || hint === "messages") return "email";
  if (hint === "pull_requests" || hint === "prs") return "pr";
  if (hint === "tasks") return "task";
  /* Guess from fields */
  if (item.from || item.from_name || item.snippet) return "email";
  if (item.head || item.base || item.number || item.merged) return "pr";
  if (item.due_date || item.assignee) return "task";
  return "item";
}

/**
 * Build a display label string for a card type.
 *
 * @param {"email"|"pr"|"task"|"item"} cardType
 * @returns {string}
 */
function cardTypeLabel(cardType) {
  if (cardType === "email") return "Email";
  if (cardType === "pr")    return "Pull Request";
  if (cardType === "task")  return "Task";
  return "Item";
}

/**
 * Build a subtitle string (sender info or author) from a raw item.
 *
 * @param {object} item
 * @param {"email"|"pr"|"task"|"item"} cardType
 * @returns {string}
 */
function buildCardSubtitle(item, cardType) {
  if (cardType === "email") {
    var name  = item.from_name || item.sender_name || "";
    var email = item.from      || item.sender      || "";
    if (name && email) return name + " <" + email + ">";
    if (email)         return email;
    if (name)          return name;
    return "";
  }
  if (cardType === "pr") {
    var author = item.author || item.user || (item.user && item.user.login) || "";
    var repo   = item.repo   || item.repository || "";
    if (author && repo) return repo + " - by " + author;
    if (author)         return "by " + author;
    if (repo)           return repo;
    return "";
  }
  return item.author || item.created_by || item.owner || "";
}

/**
 * Parse an agent text/tool_result blob and extract email or item cards.
 * Attempts JSON parsing first, then falls back to heuristic line parsing.
 * Each card now carries: { title, subtitle, body, label, cardType, action_id, metadata }
 *
 * @param {string|object} raw - Agent text or parsed object
 * @param {string} [hint] - Optional key hint ("emails", "pull_requests", etc.)
 * @returns {Array<{title: string, subtitle: string, body: string, label: string, cardType: string, action_id?: string, metadata?: object}>}
 */
function extractTinderCards(raw, hint) {
  var cards = [];

  /* Unwrap Composio response format: { data: ..., error: ..., successfull: ... } */
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "data" in raw && ("successfull" in raw || "successful" in raw || "logId" in raw)) {
    raw = raw.data;
    if (!raw) return cards;
  }

  /* If raw is already an array (e.g. from a tool_result with a list) */
  if (Array.isArray(raw)) {
    raw.forEach(function(item) {
      if (!item || typeof item !== "object") return;
      var cardType = inferCardType(item, hint);
      cards.push({
        title:     item.subject || item.title || item.name || item.sender || "Item",
        subtitle:  buildCardSubtitle(item, cardType),
        body:      item.snippet || item.body || item.description || item.content || "",
        label:     cardTypeLabel(cardType),
        cardType:  cardType,
        action_id: item.id || item.action_id || null,
        metadata:  item,
      });
    });
    return cards;
  }

  /* If raw is a single object - check for known wrapper keys first */
  if (raw && typeof raw === "object") {
    var emailItems = raw.emails || raw.messages;
    var prItems    = raw.pull_requests || raw.prs;
    var taskItems  = raw.tasks;
    var genericItems = raw.items || raw.results;

    if (Array.isArray(emailItems)) return extractTinderCards(emailItems, "emails");
    if (Array.isArray(prItems))    return extractTinderCards(prItems,    "pull_requests");
    if (Array.isArray(taskItems))  return extractTinderCards(taskItems,  "tasks");
    if (Array.isArray(genericItems)) return extractTinderCards(genericItems, hint);

    /* Single object as one card */
    var cardType = inferCardType(raw, hint);
    cards.push({
      title:     raw.subject || raw.title || raw.name || raw.sender || "Item",
      subtitle:  buildCardSubtitle(raw, cardType),
      body:      raw.snippet || raw.body || raw.description || raw.content || "",
      label:     cardTypeLabel(cardType),
      cardType:  cardType,
      action_id: raw.id || raw.action_id || null,
      metadata:  raw,
    });
    return cards;
  }

  /* String - try JSON first */
  if (typeof raw === "string") {
    var str = raw.trim();

    /* Try full JSON parse */
    try {
      var parsed = JSON.parse(str);
      return extractTinderCards(parsed, hint);
    } catch (e) {
      /* Not valid JSON */
    }

    /* Try line-by-line JSON objects */
    var lines = str.split("\n");
    var foundJson = false;
    lines.forEach(function(line) {
      line = line.trim();
      if (!line) return;
      try {
        var obj = JSON.parse(line);
        var c = extractTinderCards(obj, hint);
        c.forEach(function(card) { cards.push(card); });
        foundJson = true;
      } catch (e) {
        /* Skip */
      }
    });
    if (foundJson) return cards;

    /* Heuristic: look for numbered items like "1. Subject - Snippet" */
    var numbered = str.match(/\d+\.\s+(.+)/g);
    if (numbered && numbered.length > 1) {
      numbered.forEach(function(m) {
        var clean = m.replace(/^\d+\.\s+/, "").trim();
        var dashIdx = clean.indexOf(" - ");
        if (dashIdx > -1) {
          cards.push({
            title:    clean.slice(0, dashIdx),
            subtitle: "",
            body:     clean.slice(dashIdx + 3),
            label:    "Item",
            cardType: "item",
          });
        } else {
          cards.push({ title: clean, subtitle: "", body: "", label: "Item", cardType: "item" });
        }
      });
      return cards;
    }

    /* Last resort: whole text as one card */
    if (str.length > 0) {
      var lines2 = str.split("\n").filter(function(l) { return l.trim(); });
      cards.push({
        title:    lines2[0] ? lines2[0].slice(0, 80) : "Item",
        subtitle: "",
        body:     lines2.slice(1).join("\n").trim() || str,
        label:    "Item",
        cardType: "item",
      });
    }
  }

  return cards;
}

/**
 * Enqueue a new card item for the tinder pattern.
 * If no card is currently shown, show it immediately.
 *
 * @param {{title: string, body: string, action_id?: string}} data
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
 * Renders the rich card structure: label pill, subtitle, title, body snippet.
 * Shows "All done!" summary when the queue is exhausted.
 */
function showNextTinderCard() {
  /* Remove any lingering animation classes */
  dom.tinderCard.classList.remove("exit-left", "exit-right");
  dom.tinderCard.style.borderColor = "";

  if (state.tinder.queue.length === 0) {
    state.tinder.current = null;

    /* Show completion state inside the card */
    dom.tinderCard.className = "";
    dom.tinderCardLabel.textContent = "";
    dom.tinderCardLabel.className = "";
    dom.tinderCardSubtitle.textContent = "";
    dom.tinderCardTitle.textContent = "All done!";
    dom.tinderCardBody.textContent =
      "Processed " + state.tinder.index + " item" + (state.tinder.index === 1 ? "" : "s") + ".";
    dom.tinderReplyTextarea.value = "";
    dom.tinderReplyTextarea.placeholder = "";
    dom.tinderCounter.textContent = "\u2713 " + state.tinder.index + " reviewed";
    return;
  }

  var card = state.tinder.queue.shift();
  state.tinder.current = card;
  state.tinder.index++;

  /* Set card type class for left border and animation tints */
  dom.tinderCard.className = card.cardType ? "card-type-" + card.cardType : "";

  /* Label pill */
  dom.tinderCardLabel.textContent = card.label || "";
  dom.tinderCardLabel.className = card.cardType ? "label-" + card.cardType : "";

  /* Subtitle (sender / author) - shown inline in header */
  dom.tinderCardSubtitle.textContent = card.subtitle || "";

  /* Title (subject / PR title) */
  dom.tinderCardTitle.textContent = card.title || "";

  /* Full body - scrollable, not truncated */
  dom.tinderCardBody.textContent = card.body || "";

  /*
   * Populate reply textarea.
   * Check if a draft is already available (matched by emailId),
   * otherwise pre-fill with whatever was attached to the card,
   * or leave empty with a placeholder while the agent drafts.
   */
  var emailId = card.emailId || card.action_id || null;
  var existingDraft = emailId ? (state._tinderDrafts[emailId] || null) : null;
  var draftText = existingDraft || card.draft || "";
  dom.tinderReplyTextarea.value = draftText;
  dom.tinderReplyTextarea.placeholder = draftText ? "" : "Agent is drafting a reply...";

  var total = state.tinder.total || "?";
  dom.tinderCounter.textContent = state.tinder.index + " of " + total;
}

/**
 * Animate the tinder card out and then show the next one.
 * When approving, captures the current textarea value and POSTs it
 * as the reply body so the user's edits are preserved.
 *
 * @param {"left"|"right"} direction
 * @param {string} sessionId
 * @param {string|null} actionId
 * @param {boolean} approved
 */
function dismissTinderCard(direction, sessionId, actionId, approved) {
  if (!state.tinder.current) return;

  dom.tinderCard.classList.add(direction === "right" ? "exit-right" : "exit-left");

  if (sessionId) {
    var endpoint = approved ? "/approve/" : "/reject/";
    var url = BACKEND + endpoint + encodeURIComponent(sessionId) + "/" + encodeURIComponent(actionId || "item");

    if (approved) {
      /* Include the user's (possibly edited) reply text in the approval body */
      var replyText = dom.tinderReplyTextarea.value || "";
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply_text: replyText, reason: "User approved" }),
      }).catch(function(e) { console.warn("tinder approve error:", e); });
    } else {
      fetch(url, { method: "POST" })
        .catch(function(e) { console.warn("tinder reject error:", e); });
    }
  }

  setTimeout(function() {
    showNextTinderCard();
  }, 360);
}

/* =========================================================
   Diff pattern
   ========================================================= */

/**
 * Syntax-highlight a line of code/text using simple regex rules.
 * Returns an HTML string with spans for comments, strings, and keywords.
 *
 * @param {string} line - Plain text line
 * @returns {string} HTML string
 */
function syntaxHighlightLine(line) {
  /* Escape HTML first */
  var esc = line
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  /* Single-line comments (// or #) */
  esc = esc.replace(/(\/\/.*|#.*)$/, '<span style="color:var(--text-muted);font-style:italic;">$1</span>');

  /* Strings (double and single quoted, simple) */
  esc = esc.replace(/(&quot;[^&]*&quot;|&#039;[^&]*&#039;|"[^"]*"|'[^']*')/g,
    '<span style="color:#86efac;">$1</span>');

  /* Keywords */
  var keywords = /\b(function|var|let|const|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|typeof|instanceof)\b/g;
  esc = esc.replace(keywords, '<span style="color:#c4b5fd;">$1</span>');

  return esc;
}

/**
 * Parse raw text into diff content and render it into both panels.
 * Supports unified diff format and plain "before/after" text blocks.
 * If the text is not a diff, place it in the proposed panel as-is.
 *
 * @param {string} text - raw diff or plain text
 */
function appendDiffContent(text) {
  var lines = text.split("\n");
  var hasUnifiedMarkers = lines.some(function(l) {
    return l.startsWith("---") || l.startsWith("+++") || l.startsWith("@@");
  });

  if (hasUnifiedMarkers) {
    /* Unified diff mode */
    lines.forEach(function(line, idx) {
      if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) return;
      var lineNum = idx + 1;
      if (line.startsWith("+")) {
        appendDiffLine(dom.diffProposed, line.slice(1), lineNum, "added");
      } else if (line.startsWith("-")) {
        appendDiffLine(dom.diffOriginal, line.slice(1), lineNum, "removed");
      } else {
        var content = line.startsWith(" ") ? line.slice(1) : line;
        appendDiffLine(dom.diffOriginal, content, lineNum, "");
        appendDiffLine(dom.diffProposed, content, lineNum, "");
      }
    });
  } else {
    /* Check for "original/proposed" section markers in the text */
    var origMarker = /^#+\s*(original|before|current)/i;
    var propMarker = /^#+\s*(proposed|after|new|updated)/i;
    var currentTarget = dom.diffProposed;  /* Default - put everything in proposed */
    var lineNum = 1;

    lines.forEach(function(line) {
      if (origMarker.test(line)) {
        currentTarget = dom.diffOriginal;
        return;
      }
      if (propMarker.test(line)) {
        currentTarget = dom.diffProposed;
        return;
      }
      appendDiffLine(currentTarget, line, lineNum++, "");
    });
  }

  syncDiffScroll();
}

/**
 * Append a single syntax-highlighted line to a diff panel.
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
  text.innerHTML = syntaxHighlightLine(content);

  row.appendChild(num);
  row.appendChild(text);
  panel.appendChild(row);
}

/** Sync scroll positions of both diff panels proportionally. */
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

/** Reset whiteboard to an empty state. */
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

/** Apply the current pan/scale transform to the whiteboard node container. */
function applyWbTransform() {
  dom.wbNodes.style.transform =
    "translate(" + state.wb.panX + "px," + state.wb.panY + "px) scale(" + state.wb.scale + ")";
  dom.wbNodes.style.transformOrigin = "0 0";
  redrawConnections();
}

/**
 * Add a node to the whiteboard at the given position or auto-position it.
 * Nodes appear with a scale-up animation defined in CSS.
 *
 * @param {{title?: string, body?: string, x?: number, y?: number}} opts
 * @returns {object} The node record
 */
function addWhiteboardNode(opts) {
  var id = "wbn-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  var count = state.wb.nodes.length;

  /* Auto-layout: flowing grid with 3 columns */
  var cols = 3;
  var col  = count % cols;
  var row  = Math.floor(count / cols);
  var x    = opts.x != null ? opts.x : 60 + col * 360;
  var y    = opts.y != null ? opts.y : 60 + row * 200;

  var el = document.createElement("div");
  el.className = "wb-node";
  el.style.left = x + "px";
  el.style.top  = y + "px";

  if (opts.title) {
    var titleEl = document.createElement("div");
    titleEl.className = "wb-node-title";
    titleEl.textContent = opts.title;
    el.appendChild(titleEl);
  }

  var bodyEl = document.createElement("div");
  bodyEl.className = "wb-node-body";
  bodyEl.textContent = opts.body || "";
  el.appendChild(bodyEl);

  dom.wbNodes.appendChild(el);

  var node = { id: id, x: x, y: y, el: el };
  state.wb.nodes.push(node);

  /* Connect to previous node */
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
 * @param {object} node - Node record with .el, .x, .y
 */
function setupNodeDrag(node) {
  node.el.addEventListener("mousedown", function(e) {
    e.stopPropagation();
    state.wb.draggingNode = {
      node:   node,
      startX: e.clientX,
      startY: e.clientY,
      origX:  node.x,
      origY:  node.y,
    };
  });
}

/** Redraw all SVG bezier connection lines between whiteboard nodes. */
function redrawConnections() {
  dom.wbConnections.innerHTML = "";
  state.wb.connections.forEach(function(conn) {
    var fromNode = state.wb.nodes.find(function(n) { return n.id === conn.from; });
    var toNode   = state.wb.nodes.find(function(n) { return n.id === conn.to; });
    if (!fromNode || !toNode) return;

    var fw = fromNode.el.offsetWidth  || 180;
    var fh = fromNode.el.offsetHeight || 80;

    var x1 = fromNode.x + fw + state.wb.panX;
    var y1 = fromNode.y + fh / 2 + state.wb.panY;
    var x2 = toNode.x + state.wb.panX;
    var y2 = toNode.y + fh / 2 + state.wb.panY;

    var cx = (x1 + x2) / 2;
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d",
      "M " + x1 + " " + y1 +
      " C " + cx + " " + y1 +
      " " + cx + " " + y2 +
      " " + x2 + " " + y2
    );
    path.setAttribute("stroke", "rgba(255,255,255,0.08)");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("fill", "none");
    dom.wbConnections.appendChild(path);
  });
}

/**
 * Attempt to parse JSON node objects from the whiteboard text buffer.
 * Expects lines like: {"title":"...", "body":"..."} or plain text bullets.
 */
function tryParseWbBuffer() {
  var buf = (state._wbBuffer || "").trim();
  if (!buf) return;

  /* Try full JSON array first */
  try {
    var arr = JSON.parse(buf);
    if (Array.isArray(arr)) {
      arr.forEach(function(obj) {
        addWhiteboardNode({
          title: obj.title || obj.name || "",
          body:  obj.body  || obj.description || obj.content || obj.text || "",
        });
      });
      state._wbBuffer = "";
      return;
    }
  } catch (e) { /* Not a JSON array */ }

  /* Try line-by-line JSON */
  var lines = buf.split("\n");
  var remaining = "";
  lines.forEach(function(line) {
    line = line.trim();
    if (!line) return;
    try {
      var obj = JSON.parse(line);
      addWhiteboardNode({
        title: obj.title || obj.name || "",
        body:  obj.body  || obj.description || obj.content || obj.text || "",
      });
    } catch (e) {
      remaining += line + "\n";
    }
  });
  state._wbBuffer = remaining;
}

/**
 * Parse a plain-text whiteboard response into discrete nodes.
 * Splits on blank lines, numbered items, or heading lines.
 *
 * @param {string} text
 */
function parseWbText(text) {
  if (!text || !text.trim()) return;

  /* Try JSON first */
  try {
    var parsed = JSON.parse(text.trim());
    var items = Array.isArray(parsed) ? parsed : [parsed];
    items.forEach(function(obj) {
      addWhiteboardNode({
        title: obj.title || obj.name || "",
        body:  obj.body  || obj.description || obj.content || obj.text || "",
      });
    });
    return;
  } catch (e) { /* Not JSON */ }

  /* Split on blank lines to get paragraphs/sections */
  var sections = text.trim().split(/\n\s*\n/);
  sections.forEach(function(section) {
    section = section.trim();
    if (!section) return;
    var lines = section.split("\n").map(function(l) { return l.trim(); }).filter(Boolean);
    /* First line is the title if it looks like a heading (short, or ends with :) */
    var title = "";
    var body  = section;
    if (lines.length > 1 && (lines[0].length < 60 || lines[0].endsWith(":"))) {
      title = lines[0].replace(/:$/, "");
      body  = lines.slice(1).join("\n");
    }
    addWhiteboardNode({ title: title, body: body });
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
      /* Accumulate into buffer; cards are built from tool_result events */
      state._tinderBuffer = (state._tinderBuffer || "") + chunk;
      /* If cards are already showing, route text to the commentary area below the card */
      if (state.tinder.current || state.tinder.index > 0) {
        dom.tinderCommentary.textContent = state._tinderBuffer.trim();
      } else {
        /* No cards yet - show a loading state */
        dom.tinderCardLabel.textContent = "";
        dom.tinderCardSubtitle.textContent = "";
        dom.tinderCardTitle.textContent = "Loading...";
        dom.tinderCardBody.textContent = "";
        dom.tinderReplyTextarea.value = "";
      }
      break;

    case "diff":
      state._diffBuffer = (state._diffBuffer || "") + chunk;
      /* Append incrementally */
      appendDiffContent(chunk);
      break;

    case "whiteboard":
      state._wbBuffer = (state._wbBuffer || "") + chunk;
      tryParseWbBuffer();
      break;

    default:
      break;
  }
}

/**
 * Extract a draft reply text string from a tool result object.
 * Handles various shapes the backend may return for draft_reply results.
 *
 * @param {*} result - Tool result from draft_reply
 * @returns {string} The draft text, or empty string if not found
 */
function extractDraftText(result) {
  if (!result) return "";
  /* Unwrap Composio wrapper */
  if (typeof result === "object" && "data" in result && ("successfull" in result || "successful" in result)) {
    result = result.data || result;
  }
  if (typeof result === "string") return result.trim();
  if (typeof result === "object") {
    return (
      result.draft ||
      result.reply ||
      result.body ||
      result.text ||
      result.content ||
      result.message ||
      ""
    ).trim();
  }
  return "";
}

/**
 * Handle a tool_result event for the tinder pattern.
 *
 * - For list/read email tools: extract email cards and enqueue them.
 * - For draft_reply tools: match the draft to an existing card by email_id,
 *   store in _tinderDrafts map, and update the textarea if the card is current.
 *
 * @param {string} toolName
 * @param {*} result
 */
function handleTinderToolResult(toolName, result) {
  /* Unwrap Composio wrapper if present */
  if (result && typeof result === "object" && !Array.isArray(result) && "data" in result && ("successfull" in result || "successful" in result || "logId" in result)) {
    result = result.data || result;
  }
  /*
   * Detect draft_reply results and match them to email cards.
   * Tool names may vary - check common patterns.
   */
  var isDraft = /draft/i.test(toolName);
  if (isDraft) {
    var draftText = extractDraftText(result);
    if (draftText) {
      /*
       * Try to find which email this draft belongs to.
       * The result may carry an email_id, message_id, or thread_id field.
       */
      var emailId = null;
      if (result && typeof result === "object") {
        emailId = result.email_id || result.message_id || result.thread_id || result.id || null;
      }

      if (emailId) {
        /* Store the draft keyed by email ID for later lookup */
        state._tinderDrafts[emailId] = draftText;

        /* If the current card matches this email ID, update the textarea live */
        var current = state.tinder.current;
        if (current && (current.emailId === emailId || current.action_id === emailId)) {
          dom.tinderReplyTextarea.value = draftText;
          dom.tinderReplyTextarea.placeholder = "";
        }

        /* Also update any queued card that matches */
        state.tinder.queue.forEach(function(card) {
          if (card.emailId === emailId || card.action_id === emailId) {
            card.draft = draftText;
          }
        });
      } else {
        /*
         * No email_id in result - attach the draft to the current card
         * if no draft is set yet, or to the last queued card.
         */
        var current = state.tinder.current;
        if (current && !dom.tinderReplyTextarea.value) {
          dom.tinderReplyTextarea.value = draftText;
          dom.tinderReplyTextarea.placeholder = "";
        } else if (state.tinder.queue.length > 0) {
          var lastCard = state.tinder.queue[state.tinder.queue.length - 1];
          if (!lastCard.draft) {
            lastCard.draft = draftText;
          }
        }
      }
    }
    return;
  }

  /* Non-draft tool result - extract email/PR cards as before */
  var cards = extractTinderCards(result);
  if (cards.length > 0) {
    /* Clear any streaming buffer since we now have real cards */
    state._tinderBuffer = "";
    dom.tinderCardTitle.textContent = "";
    dom.tinderCardBody.innerHTML = "";

    /* Attach email IDs to cards for later draft matching */
    cards.forEach(function(card) {
      /* Prefer the metadata id as the email lookup key */
      card.emailId = (card.metadata && (card.metadata.id || card.metadata.message_id)) || card.action_id || null;
      /* Check if a draft already arrived before the card */
      if (card.emailId && state._tinderDrafts[card.emailId]) {
        card.draft = state._tinderDrafts[card.emailId];
      }
      enqueueTinderCard(card);
    });
  }
}

/**
 * Clear pattern-specific buffers and content for a fresh session.
 *
 * @param {string} pattern
 */
function clearPatternContent(pattern) {
  state._tinderBuffer = "";
  state._wbBuffer = "";
  state._diffBuffer = "";
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
      state._tinderDrafts = {};
      dom.tinderCard.className = "";
      dom.tinderCard.style.borderColor = "";
      dom.tinderCardLabel.textContent = "";
      dom.tinderCardLabel.className = "";
      dom.tinderCardSubtitle.textContent = "";
      dom.tinderCardTitle.textContent = "";
      dom.tinderCardBody.textContent = "";
      dom.tinderReplyTextarea.value = "";
      dom.tinderReplyTextarea.placeholder = "Agent is drafting a reply...";
      dom.tinderCommentary.textContent = "";
      dom.tinderCounter.textContent = "";
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
 * Uses addEventListener for each named event type (NOT onmessage) so
 * named events from the server are correctly dispatched.
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

  /**
   * Parse and dispatch one SSE event payload.
   *
   * @param {MessageEvent} evt
   */
  function parseAndHandle(evt) {
    var data;
    try {
      data = JSON.parse(evt.data);
    } catch (err) {
      console.warn("SSE parse error:", err, evt.data);
      return;
    }
    if (!data.event_type) data.event_type = evt.type;
    handleAgentEvent(data);
  }

  /* onmessage only fires for unnamed events; named events need explicit listeners */
  es.onmessage = parseAndHandle;
  SSE_EVENT_TYPES.forEach(function(t) {
    es.addEventListener(t, parseAndHandle);
  });

  es.onerror = function() {
    if (state.isStreaming) {
      finalizeAgentMessage();
      hideThinking();
      showErrorInPattern("Connection lost. Please try again.");
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
      } else if (state.currentPattern === "tinder") {
        /* Tool results are the primary source of cards in tinder mode */
        handleTinderToolResult(
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

  /* Finalize tinder: update reply placeholder if no draft arrived */
  if (state.currentPattern === "tinder") {
    if (dom.tinderReplyTextarea.value === "" && dom.tinderReplyTextarea.placeholder === "Agent is drafting a reply...") {
      dom.tinderReplyTextarea.placeholder = "No reply needed - or type your own";
    }
    /* Clear commentary since streaming is done */
    dom.tinderCommentary.textContent = "";
    if (state._tinderBuffer && state.tinder.queue.length === 0 && !state.tinder.current) {
      var cards = extractTinderCards(state._tinderBuffer);
      if (cards.length > 0) {
        state.tinder.total = cards.length;
        cards.forEach(function(c) { enqueueTinderCard(c); });
      } else {
        dom.tinderCard.className = "";
        dom.tinderCardLabel.textContent = "";
        dom.tinderCardLabel.className = "";
        dom.tinderCardSubtitle.textContent = "";
        dom.tinderCardTitle.textContent = "Done";
        dom.tinderCardBody.textContent = state._tinderBuffer.trim() || "Agent completed.";
        dom.tinderReplyTextarea.value = "";
        dom.tinderCounter.textContent = "Complete";
      }
    } else if (state.tinder.queue.length === 0 && !state.tinder.current) {
      dom.tinderCounter.textContent = "No items found";
    }
    state._tinderBuffer = "";
  }

  /* Finalize whiteboard: flush any remaining buffer as a plain-text node */
  if (state.currentPattern === "whiteboard") {
    var remaining = (state._wbBuffer || "").trim();
    if (remaining && state.wb.nodes.length === 0) {
      parseWbText(remaining);
    } else if (remaining) {
      addWhiteboardNode({ body: remaining });
    }
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
  showErrorInPattern(msg);
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
 * @param {string} rawToolName
 * @param {string} description
 * @param {string} sessionId
 */
function showApprovalModal(actionId, rawToolName, description, sessionId) {
  state.pendingApproval = { action_id: actionId, session_id: sessionId };
  dom.approvalToolName.textContent = rawToolName;
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
      var agent     = body.agent || "Agent";

      clearPatternContent(pattern);
      showPattern(pattern);

      createSession(sessionId, agent, pattern, text);

      if (pattern === "chat") {
        appendChatMessage("user", text);
        showThinking();
      }

      if (pattern === "tinder" && body.total) {
        state.tinder.total = body.total;
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
   Whiteboard mouse events (pan + node drag)
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

/* New session - clear view and return to welcome */
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

/* Tinder approve / reject */
dom.tinderApprove.addEventListener("click", function() {
  var card = state.tinder.current;
  dismissTinderCard("right", state.currentSessionId, card && card.action_id, true);
});

dom.tinderReject.addEventListener("click", function() {
  var card = state.tinder.current;
  dismissTinderCard("left", state.currentSessionId, card && card.action_id, false);
});

/* Diff approve / reject all */
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

/* Monitor panel toggle */
dom.monitorClose.addEventListener("click", function() {
  dom.monitorPanel.classList.add("hidden");
});

/* Clicking agent pills area opens/closes the monitor */
dom.agentPills.addEventListener("click", function() {
  refreshMonitorList();
  dom.monitorPanel.classList.toggle("hidden");
});

/* Clicking connection status also opens monitor */
document.getElementById("conn-status").addEventListener("click", function() {
  refreshMonitorList();
  dom.monitorPanel.classList.toggle("hidden");
});

/* =========================================================
   Integrations - connection status + OAuth flow
   ========================================================= */

/**
 * Update the visual state of a connect button.
 *
 * @param {HTMLElement} btn - The button element to update
 * @param {"connected"|"pending"|"disconnected"} status
 */
function setConnectBtnStatus(btn, status) {
  btn.classList.remove("connect-btn--connected", "connect-btn--disconnected", "connect-btn--pending");
  if (status === "connected") {
    btn.classList.add("connect-btn--connected");
    btn.title = "Connected";
    btn.disabled = true;
  } else if (status === "pending") {
    btn.classList.add("connect-btn--pending");
    btn.title = "Waiting for authorization...";
    btn.disabled = false;
  } else {
    btn.classList.add("connect-btn--disconnected");
    btn.title = "Click to connect";
    btn.disabled = false;
  }
}

/**
 * Fetch the current connection state from the backend and update buttons.
 * Called on boot and after an OAuth connect attempt.
 */
function refreshConnections() {
  var gmailBtn   = document.getElementById("connect-gmail-btn");
  var githubBtn  = document.getElementById("connect-github-btn");
  if (!gmailBtn || !githubBtn) return;

  fetch(BACKEND + "/connections", { method: "GET", cache: "no-store" })
    .then(function(res) { return res.ok ? res.json() : []; })
    .then(function(connections) {
      var gmailConn  = null;
      var githubConn = null;
      for (var i = 0; i < connections.length; i++) {
        var svc = (connections[i].service || "").toLowerCase();
        if (svc === "gmail")  gmailConn  = connections[i];
        if (svc === "github") githubConn = connections[i];
      }

      // A Composio connection is fully active when status is "active" or "connected".
      // "initiated" means the user has not finished the OAuth flow yet.
      setConnectBtnStatus(gmailBtn,  gmailConn  && gmailConn.connected  ? "connected"  : "disconnected");
      setConnectBtnStatus(githubBtn, githubConn && githubConn.connected ? "connected" : "disconnected");
    })
    .catch(function() {
      // Backend unreachable - show disconnected state silently
    });
}

/**
 * Initiate an OAuth flow for a service.
 * POSTs to /connect/{service}, gets back a redirect_url, and opens it.
 * After the user completes auth, Composio handles the callback server-side.
 *
 * @param {string} service - "gmail" or "github"
 * @param {HTMLElement} btn - The button that was clicked
 */
function initiateOAuth(service, btn) {
  btn.disabled = true;
  btn.textContent = "Connecting...";

  fetch(BACKEND + "/connect/" + encodeURIComponent(service), { method: "POST" })
    .then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function(data) {
      if (data.stub) {
        // Stub mode - no real OAuth needed, just refresh to show connected
        refreshConnections();
        return;
      }
      if (data.redirect_url) {
        setConnectBtnStatus(btn, "pending");
        // Open the Composio OAuth redirect in a new tab
        window.open(data.redirect_url, "_blank", "noopener,noreferrer");
        // Poll for connection completion every 4 seconds for up to 2 minutes
        var attempts = 0;
        var maxAttempts = 30;
        var pollId = setInterval(function() {
          attempts++;
          refreshConnections();
          // Stop polling once the button goes connected or we time out
          var currentStatus = btn.classList.contains("connect-btn--connected");
          if (currentStatus || attempts >= maxAttempts) {
            clearInterval(pollId);
            if (!currentStatus) setConnectBtnStatus(btn, "disconnected");
          }
        }, 4000);
      } else {
        // Unexpected - treat as disconnected
        setConnectBtnStatus(btn, "disconnected");
      }
    })
    .catch(function(e) {
      console.warn("OAuth connect error:", e);
      setConnectBtnStatus(btn, "disconnected");
    });
}

/* Wire up connect buttons */
(function() {
  var gmailBtn  = document.getElementById("connect-gmail-btn");
  var githubBtn = document.getElementById("connect-github-btn");

  if (gmailBtn) {
    gmailBtn.addEventListener("click", function() {
      initiateOAuth("gmail", gmailBtn);
    });
  }

  if (githubBtn) {
    githubBtn.addEventListener("click", function() {
      initiateOAuth("github", githubBtn);
    });
  }
})();

/* =========================================================
   Boot
   ========================================================= */

/** Initialize the application on page load. */
function boot() {
  showPattern("welcome");
  checkHealth();
  setInterval(checkHealth, HEALTH_INTERVAL_MS);
  refreshConnections();
  dom.intentInput.focus();
}

boot();
