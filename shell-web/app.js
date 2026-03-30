/**
 * app.js - Monet Shell Web App
 *
 * Handles intent submission, SSE streaming from the agent backend,
 * and UI pattern switching (chat, tinder, diff, whiteboard).
 *
 * Backend: http://localhost:8420
 *   POST /intent  { text }  -> { session_id, agent, ui_pattern }
 *   GET  /stream/{session_id} -> SSE stream of agent events
 *   GET  /status  -> health check
 */

"use strict";

/* =========================================================
   Constants
   ========================================================= */

const BACKEND = "http://localhost:8420";
const HEALTH_INTERVAL_MS = 5000;

/* =========================================================
   State
   ========================================================= */

let currentPattern = "welcome";
let isStreaming = false;
let currentEventSource = null;
let currentAgentMessageEl = null;

/* =========================================================
   DOM references
   ========================================================= */

const statusDot = document.getElementById("status-dot");
const statusLabel = document.getElementById("status-label");
const mainContent = document.getElementById("main-content");
const intentInput = document.getElementById("intent-input");
const intentSend = document.getElementById("intent-send");
const chatMessages = document.getElementById("chat-messages");
const tinderText = document.getElementById("tinder-text");
const diffProposed = document.getElementById("diff-proposed");
const whiteboardText = document.getElementById("whiteboard-text");
const tinderApprove = document.getElementById("tinder-approve");
const tinderReject = document.getElementById("tinder-reject");

/* =========================================================
   Pattern switching
   ========================================================= */

/**
 * Show the given UI pattern view, hiding all others.
 * Valid values: "welcome", "chat", "tinder", "diff", "whiteboard"
 */
function showPattern(pattern) {
  currentPattern = pattern;

  const views = mainContent.querySelectorAll(".pattern-view");
  views.forEach(function(v) {
    v.classList.remove("active");
  });

  const viewId = pattern === "welcome" ? "welcome-screen" : pattern + "-view";
  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add("active");
  } else {
    // Unknown pattern - fall back to chat
    document.getElementById("chat-view").classList.add("active");
    currentPattern = "chat";
  }
}

/* =========================================================
   Status / health check
   ========================================================= */

/**
 * Poll the backend health endpoint and update the status dot.
 */
function checkHealth() {
  fetch(BACKEND + "/status", { method: "GET", cache: "no-store" })
    .then(function(res) {
      if (res.ok) {
        setStatus(true);
      } else {
        setStatus(false);
      }
    })
    .catch(function() {
      setStatus(false);
    });
}

/**
 * Update the status dot and label based on connection state.
 */
function setStatus(connected) {
  if (connected) {
    statusDot.classList.add("connected");
    statusLabel.textContent = "Connected";
  } else {
    statusDot.classList.remove("connected");
    statusLabel.textContent = "Offline";
  }
}

/* =========================================================
   Chat helpers
   ========================================================= */

/**
 * Append a message bubble to the chat view.
 * role: "user" | "agent" | "status"
 * Returns the created element (useful for appending streaming text).
 */
function appendChatMessage(role, text) {
  const el = document.createElement("div");
  el.className = "message " + role;
  el.textContent = text || "";
  chatMessages.appendChild(el);
  scrollChatToBottom();
  return el;
}

/**
 * Append a tool call badge below the current agent message.
 */
function appendToolCallBadge(toolName) {
  const badge = document.createElement("div");
  badge.className = "tool-call-badge";
  badge.textContent = toolName;
  chatMessages.appendChild(badge);
  scrollChatToBottom();
}

/**
 * Scroll the chat messages container to the bottom.
 */
function scrollChatToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Create an empty agent message bubble ready to receive streamed text.
 */
function startAgentMessage() {
  currentAgentMessageEl = appendChatMessage("agent", "");
  return currentAgentMessageEl;
}

/**
 * Append a chunk of text to the current streaming agent message.
 */
function appendToAgentMessage(chunk) {
  if (!currentAgentMessageEl) {
    currentAgentMessageEl = startAgentMessage();
  }
  // Clear thinking indicator text before appending real content
  if (currentAgentMessageEl.classList.contains("thinking-dots")) {
    currentAgentMessageEl.classList.remove("thinking-dots");
    currentAgentMessageEl.textContent = "";
  }
  currentAgentMessageEl.textContent += chunk;
  scrollChatToBottom();
}

/* =========================================================
   Pattern content setters
   ========================================================= */

/**
 * Append streaming text to whichever pattern is active.
 */
function appendStreamText(chunk) {
  switch (currentPattern) {
    case "chat":
      appendToAgentMessage(chunk);
      break;
    case "tinder":
      tinderText.textContent += chunk;
      break;
    case "diff":
      diffProposed.textContent += chunk;
      break;
    case "whiteboard":
      whiteboardText.textContent += chunk;
      break;
  }
}

/**
 * Clear the content areas for a fresh response.
 */
function clearPatternContent(pattern) {
  switch (pattern) {
    case "chat":
      // Keep history - just ensure a new agent message starts fresh
      currentAgentMessageEl = null;
      break;
    case "tinder":
      tinderText.textContent = "";
      break;
    case "diff":
      diffProposed.textContent = "";
      document.getElementById("diff-original").textContent = "";
      break;
    case "whiteboard":
      whiteboardText.textContent = "";
      break;
  }
}

/* =========================================================
   SSE stream handling
   ========================================================= */

/**
 * Close any existing SSE connection.
 */
function closeStream() {
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
  isStreaming = false;
  intentSend.disabled = false;
  intentInput.disabled = false;
}

/**
 * Connect to the SSE stream for the given session and handle events.
 */
function connectStream(sessionId) {
  closeStream();
  isStreaming = true;
  intentSend.disabled = true;
  intentInput.disabled = true;

  const url = BACKEND + "/stream/" + encodeURIComponent(sessionId);
  const es = new EventSource(url);
  currentEventSource = es;

  // Handle both named and unnamed SSE events
  function parseAndHandle(evt) {
    let data;
    try {
      data = JSON.parse(evt.data);
    } catch (err) {
      console.warn("SSE parse error:", err, evt.data);
      return;
    }
    handleAgentEvent(data);
  }

  // onmessage only fires for unnamed events
  es.onmessage = parseAndHandle;

  // Add listeners for all named event types the backend sends
  var eventTypes = ["thinking", "text", "tool_call", "tool_result",
                    "approval_required", "approval_resolved", "error", "done"];
  eventTypes.forEach(function(t) {
    es.addEventListener(t, parseAndHandle);
  });

  es.onerror = function(err) {
    console.error("SSE error:", err);
    // Only show error if we were still actively streaming
    if (isStreaming) {
      if (currentPattern === "chat") {
        appendChatMessage("status", "Connection lost.");
      }
      closeStream();
    }
  };
}

/**
 * Dispatch a parsed SSE event to the appropriate handler.
 */
function handleAgentEvent(data) {
  const type = data.event_type;

  if (type === "text") {
    appendStreamText(data.text || "");
    return;
  }

  if (type === "thinking") {
    if (currentPattern === "chat") {
      // Show a thinking indicator - will be replaced by real text
      if (!currentAgentMessageEl || currentAgentMessageEl.textContent.trim() !== "") {
        currentAgentMessageEl = startAgentMessage();
      }
      currentAgentMessageEl.className = "message agent thinking-dots";
      currentAgentMessageEl.textContent = "Thinking";
    }
    return;
  }

  if (type === "tool_call") {
    if (currentPattern === "chat") {
      const name = data.tool_name || "tool";
      // If we have an active thinking message, clear it
      if (currentAgentMessageEl && currentAgentMessageEl.classList.contains("thinking-dots")) {
        currentAgentMessageEl.remove();
        currentAgentMessageEl = null;
      }
      appendToolCallBadge(name);
    }
    return;
  }

  if (type === "done") {
    // Clean up thinking indicator if still present
    if (currentAgentMessageEl && currentAgentMessageEl.classList.contains("thinking-dots")) {
      currentAgentMessageEl.classList.remove("thinking-dots");
      if (!currentAgentMessageEl.textContent || currentAgentMessageEl.textContent === "Thinking") {
        currentAgentMessageEl.textContent = "";
      }
    }
    currentAgentMessageEl = null;
    closeStream();
    return;
  }

  if (type === "error") {
    const msg = data.error || "An error occurred.";
    if (currentPattern === "chat") {
      appendChatMessage("status", "Error: " + msg);
    }
    closeStream();
    return;
  }
}

/* =========================================================
   Intent submission
   ========================================================= */

/**
 * Submit the current intent text to the backend.
 * Switches UI pattern and opens the SSE stream.
 */
function submitIntent() {
  const text = intentInput.value.trim();
  if (!text || isStreaming) return;

  intentInput.value = "";

  // Post intent to backend
  fetch(BACKEND + "/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text })
  })
    .then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function(body) {
      const pattern = body.ui_pattern || "chat";
      const sessionId = body.session_id;

      // Clear content and switch pattern
      clearPatternContent(pattern);
      showPattern(pattern);

      // Add user message to chat history if in chat mode
      if (pattern === "chat") {
        appendChatMessage("user", text);
        startAgentMessage();
      }

      // Connect SSE stream
      connectStream(sessionId);
    })
    .catch(function(err) {
      console.error("Intent error:", err);
      showPattern("chat");
      appendChatMessage("user", text);
      appendChatMessage("status", "Could not reach the backend. Is it running?");
      intentSend.disabled = false;
      intentInput.disabled = false;
    });
}

/* =========================================================
   Tinder button handlers
   ========================================================= */

tinderApprove.addEventListener("click", function() {
  showPattern("welcome");
});

tinderReject.addEventListener("click", function() {
  showPattern("welcome");
});

/* =========================================================
   Intent bar event listeners
   ========================================================= */

intentSend.addEventListener("click", submitIntent);

intentInput.addEventListener("keydown", function(evt) {
  if (evt.key === "Enter" && !evt.shiftKey) {
    evt.preventDefault();
    submitIntent();
  }
});

/* =========================================================
   Boot
   ========================================================= */

// Show welcome screen on load
showPattern("welcome");

// Start health polling
checkHealth();
setInterval(checkHealth, HEALTH_INTERVAL_MS);

// Focus the intent input
intentInput.focus();
