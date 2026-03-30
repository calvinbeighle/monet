# Monet Agent Architecture - Research Findings

## Table of Contents

1. [Agent Frameworks Comparison](#1-agent-frameworks-comparison)
2. [Tool/Integration Layer](#2-toolintegration-layer)
3. [Intent Classification & Routing](#3-intent-classification--routing)
4. [Architecture Patterns](#4-architecture-patterns)
5. [Tech Stack Considerations](#5-tech-stack-considerations)
6. [Recommended Architecture](#6-recommended-architecture)

---

## 1. Agent Frameworks Comparison

### LangGraph (LangChain)

**What it is:** A graph-based agent orchestration framework where agents are modeled as nodes in a directed graph with shared state. Production-grade, v1.0 released.

**Strengths:**
- Most mature for production stateful systems
- Built-in human-in-the-loop via `interrupt()` and `Command()` primitives - exactly what Monet needs for approve/reject flows
- Checkpoint-based persistence (Postgres-backed) lets agent workflows pause, resume, fork
- Conditional branching, parallel execution, iterative refinement out of the box
- Native AG-UI protocol integration for real-time UI streaming
- Reducer logic for merging concurrent state updates

**Weaknesses:**
- Single-threaded by default; true concurrency needs LangGraph Server (adds queue, DB, API layer)
- Self-hosting horizontal scaling is behind their managed cloud plan
- Adds abstraction overhead - every request passes through wrappers and middleware
- Python-first; TypeScript support exists but lags

**Verdict for Monet:** Strong candidate for orchestration layer. The graph model maps naturally to Monet's flow (intent -> agent -> UI selection -> approval -> execution). Human-in-the-loop is first-class.

---

### CrewAI

**What it is:** Role-based agent teams with intuitive task delegation. Lowest learning curve (20 lines to start).

**Strengths:**
- Role-based DSL is intuitive for defining agent responsibilities
- Parallel task execution with clear role delegation
- Active development, large community
- AG-UI protocol support (1st party)

**Weaknesses:**
- Less precise control over execution flow compared to LangGraph
- Not designed for the level of state management Monet needs
- Better suited for batch/pipeline workflows than interactive approval flows

**Verdict for Monet:** Good for inspiration on role-based agent design but not the right primary framework. Monet's approve/reject loop and dynamic UI selection need more granular control.

---

### AutoGen (Microsoft)

**What it is:** Multi-party conversation patterns for AI agents - group debates, consensus-building, sequential dialogues.

**Strengths:**
- Most diverse conversation patterns of any framework
- Good for agents that need to debate/discuss

**Weaknesses:**
- Microsoft has shifted AutoGen to maintenance mode in favor of the broader Microsoft Agent Framework
- Conversation-centric design doesn't map well to Monet's task-execution model

**Verdict for Monet:** Skip. Maintenance mode and wrong paradigm.

---

### Claude Agent SDK

**What it is:** Anthropic's SDK that embeds Claude Code's autonomous agent loop in your own applications. The same loop that powers Claude Code.

**Strengths:**
- Battle-tested loop: prompt -> evaluate -> tool calls -> results -> repeat
- Rich hook system: PreToolUse, PostToolUse, Stop, SubagentStart/Stop, PreCompact
- MCP (Model Context Protocol) integration is trivial - one line to connect external services
- Built-in tools: Read, Edit, Write, Bash, Glob, Grep, WebSearch, WebFetch, Agent (subagents)
- Permission system: allowed_tools, disallowed_tools, permission_mode (default/acceptEdits/plan/bypassPermissions)
- Automatic context compaction for long-running sessions
- Session management with resume, continue, fork patterns
- Streaming output for real-time UI updates
- Subagent composition for keeping context lean
- Cost tracking and budget limits built in
- Available in Python and TypeScript

**Weaknesses:**
- Tied to Claude models (not model-agnostic)
- Newer than LangGraph, less community tooling
- Graph-based workflow orchestration is not native (it's a loop, not a DAG)

**Verdict for Monet:** Top candidate. The hook system maps perfectly to Monet's approval flow (PreToolUse hook = user approval gate). MCP means easy integration with Gmail, GitHub, etc. Subagents handle the multi-agent routing. Session persistence handles long-running tasks.

---

### OpenAI Assistants/Agents SDK

**What it is:** OpenAI's agent framework centered on handoffs and guardrails.

**Strengths:**
- Built-in tracing with dashboard visibility
- Guardrails for input/output validation
- Multimodal and voice capabilities via GPT-4o/Realtime API
- Handoff pattern for transferring between specialized agents

**Weaknesses:**
- Locked to OpenAI models
- Less lifecycle control than Claude Agent SDK
- No MCP integration

**Verdict for Monet:** Secondary option. Could be used alongside Claude for specific tasks, but the lack of MCP and weaker lifecycle hooks make Claude Agent SDK a better primary choice.

---

### Custom Agent Loop

**Strengths:**
- Full transparency and total control
- No framework overhead
- Can be optimized for exact use case

**Weaknesses:**
- Must build tool execution, state management, error handling, retries, streaming from scratch
- Significant engineering investment
- Migration to a framework becomes necessary as complexity grows

**Verdict for Monet:** Not recommended as primary approach. Claude Agent SDK gives you a production loop with hooks for customization - essentially a "custom loop with batteries included."

---

### Framework Recommendation for Monet

**Primary: Claude Agent SDK** - for the agent execution loop, tool management, and MCP integrations. The hook system provides the approval gates Monet needs. Subagents handle routing to specialized agents (email agent, code agent, etc.).

**Secondary: LangGraph** - if you need complex multi-step workflow orchestration with branching and checkpointing beyond what Claude Agent SDK provides. Use it as the orchestration layer above the agent loop.

**Why not both at once:** Start with Claude Agent SDK only. Its subagent pattern + hooks cover 90% of Monet's v1 needs. Add LangGraph later only if workflow complexity demands it.

---

## 2. Tool/Integration Layer

### Nango

**What it is:** Open-source developer platform for product integrations. 700+ APIs supported.

**Key features:**
- Managed OAuth with token storage and auto-refresh
- White-label auth flow embeddable in your app
- Tool definitions stored in your git repo
- <100ms overhead on tool calls
- Self-hosted option (Docker) with configurable callback URLs
- Multi-tenant connection management
- Detailed logs with OpenTelemetry export

**Desktop OAuth flow:** Nango supports configurable callback URLs (INSTANCE_URL/oauth/callback), which can be adapted for desktop apps using localhost callbacks. Self-hosted deployment means all credentials stay local.

**Strengths for Monet:**
- Self-hosted = credentials never leave your infrastructure
- Open-source = full control
- Git-stored tool definitions = version controlled integrations
- Low latency overhead

**Weaknesses:**
- Self-hosted security burden falls on you (SOC 2, GDPR compliance)
- Need infrastructure expertise for credential vault security
- Less AI-agent-specific than Composio

---

### Composio

**What it is:** AI-first, MCP-native integration platform with 500+ pre-built tools.

**Key features:**
- Native MCP support - connects directly to Claude Agent SDK
- Managed OAuth + automated token lifecycle
- SOC 2 compliant (managed)
- Rate limit handling, retries built in
- Pre-built tool definitions optimized for AI agents

**Strengths for Monet:**
- MCP-native means trivial integration with Claude Agent SDK
- Pre-built Gmail, GitHub, etc. tools ready to use
- Managed platform = less operational burden
- Credentials never reach agent context (security)

**Weaknesses:**
- Less control than Nango
- Managed service = dependency on their platform
- Fewer total integrations (500 vs 700)

---

### Integration Layer Recommendation for Monet

**Recommended: Composio for v1, with Nango as migration path for v2+**

Rationale:
- Composio's native MCP support means you can connect it to Claude Agent SDK with minimal code
- Pre-built Gmail API and GitHub API tools get you to v1 faster
- Managed OAuth handling eliminates the OAuth complexity for desktop apps
- When you need more control or self-hosting, migrate critical integrations to Nango

**Desktop OAuth flow approach:**
1. Composio/Nango runs as a local service (sidecar or self-hosted)
2. OAuth redirects to localhost callback URL
3. Tauri app opens system browser for OAuth consent
4. Callback captured by local server, tokens stored securely
5. Agent accesses tools via MCP connection to Composio/Nango

---

## 3. Intent Classification & Routing

### Architecture for Monet's Intent System

Monet needs two classification steps:
1. **Task classification** - what does the user want to do? (email reply, code review, content brainstorm, etc.)
2. **UI pattern selection** - which of the 4 patterns best displays the result? (Tinder, Whiteboard, iMessage, Diff)

### Approach: LLM-Based Routing with Semantic Fallback

**Layer 1 - Semantic Router (fast, cheap):**
- Embed a library of canonical intent examples for each agent/UI combination
- Use vector similarity to match incoming intent to nearest category
- If confidence > threshold, route directly (no LLM call needed)
- Latency: ~50ms, cost: near zero

**Layer 2 - LLM Classifier (when uncertain):**
- When semantic similarity is ambiguous, call a small/fast model (Claude Haiku or similar)
- Structured output: `{ agent: "email"|"code"|"planning", ui_pattern: "tinder"|"whiteboard"|"imessage"|"diff", confidence: 0.0-1.0 }`
- Latency: ~200-500ms, cost: minimal with small model

**Layer 3 - Full LLM (complex intents):**
- For genuinely ambiguous or multi-step intents, use the primary model
- Can decompose into sub-tasks, each with its own agent + UI pattern

### Mapping Intent to UI Pattern

```
Intent Type          -> UI Pattern     -> Trigger Conditions
-----------------------------------------------------------
Batch email replies  -> Tinder         -> multiple similar items to decide on
Draft single reply   -> iMessage       -> communication, single thread
Code review/PR       -> Diff           -> comparing versions, edits
Code generation      -> Diff           -> showing new code vs empty
Product planning     -> Whiteboard     -> open-ended, creative, exploratory
Content ideas        -> Tinder         -> batch of options to approve/reject
Strategy/brainstorm  -> Whiteboard     -> planning, mapping, connecting ideas
Email follow-up      -> iMessage       -> conversational, sequential
```

### Implementation with Claude Agent SDK

The routing can be implemented as the first step in the agent loop:

```python
# Pseudo-code for intent routing
class IntentRouter:
    def __init__(self):
        self.semantic_router = SemanticRouter(routes=PREDEFINED_ROUTES)

    async def route(self, user_intent: str) -> RouteResult:
        # Try semantic match first
        match = self.semantic_router.match(user_intent)
        if match.confidence > 0.85:
            return match

        # Fall back to LLM classification
        result = await claude.classify(
            intent=user_intent,
            schema=RouteResult,  # structured output
        )
        return result
```

The router itself can be a Claude Agent SDK subagent with no tools - just classification.

---

## 4. Architecture Patterns

### Event-Driven Architecture (Recommended for Monet)

**Why event-driven beats request-response for Monet:**
- Agent tasks are long-running (seconds to minutes for complex tasks)
- UI needs real-time updates as agents work (streaming tokens, progress, intermediate results)
- Multiple agents may work in parallel
- User approval is asynchronous - agent pauses, user decides, agent resumes
- AG-UI protocol is inherently event-driven

**Event flow for a typical Monet interaction:**

```
User types intent
  -> IntentReceived event
  -> RouteDecided event (agent + UI pattern selected)
  -> AgentStarted event
  -> [streaming] AgentProgress events (tokens, tool calls, intermediate results)
  -> UIPatternSelected event
  -> ResultReady event (UI renders)
  -> [pause] WaitingForApproval event
  -> UserDecision event (approve/reject/edit)
  -> ActionExecuting event
  -> ActionComplete event
```

### AG-UI Protocol for Agent-to-UI Communication

AG-UI is the ideal protocol for Monet's agent-to-UI layer:
- 16 standard event types covering the full agent lifecycle
- Live token streaming for responsive multi-turn sessions
- Human-in-the-loop interrupts (pause, approve, edit, retry)
- Frontend tool calls with typed handoffs
- Sub-agent composition with scoped state
- Integrates with LangGraph, CrewAI, and is framework-agnostic
- SDKs in TypeScript (primary), with community Rust, Go, Kotlin SDKs

### State Management

**Three levels of state in Monet:**

1. **Session state** (ephemeral) - current conversation, agent progress, streaming tokens
   - Managed by Claude Agent SDK session system
   - In-memory, with session_id for resume/fork

2. **Workflow state** (durable) - pending approvals, queued actions, integration connections
   - SQLite for local persistence (desktop app)
   - Tracks: which actions are approved, which are pending, which failed

3. **User state** (persistent) - connected accounts, preferences, history
   - SQLite or encrypted local storage
   - OAuth tokens (managed by Composio/Nango)
   - UI preferences, routing history for improving classification

### Error Handling and Retry Strategy

```
Tool call fails
  -> Retry with exponential backoff (3 attempts)
  -> If transient (network, rate limit): retry silently
  -> If auth error: re-trigger OAuth flow, then retry
  -> If permanent: surface to user with context
  -> Agent can attempt alternative approach (built into Claude's loop)

Agent loop fails
  -> Save session state (Claude Agent SDK session persistence)
  -> Surface error to user with "Retry" option
  -> Resume from checkpoint on retry

Integration fails
  -> Composio/Nango handle token refresh automatically
  -> If refresh fails: prompt user to re-authenticate
  -> Queue action for retry after re-auth
```

### Long-Running Task Handling

1. **Subagent pattern** - delegate long tasks to subagents that run independently
2. **Progress streaming** - AG-UI events stream progress to UI in real-time
3. **Checkpoint/resume** - Claude Agent SDK sessions can be saved and resumed
4. **Budget limits** - max_turns and max_budget_usd prevent runaway agents
5. **Background execution** - for approved actions (send email, push code), execute asynchronously and notify on completion

---

## 5. Tech Stack Considerations

### Desktop Shell: Tauri 2.0 (Recommended)

**Why Tauri over Electron:**
- App size: under 10MB vs 100MB+ for Electron
- Memory: ~30-40MB idle vs 150MB+ for Electron
- Startup: under 0.5s vs 1-2s for Electron
- Security: Rust backend, minimal attack surface
- IPC: Frontend invokes Rust commands via typed IPC system

**Key Tauri feature for Monet - Sidecar process:**
- Tauri can spawn and manage external processes (sidecars)
- Python agent backend can run as a sidecar alongside the Tauri app
- IPC between Tauri (Rust) and Python sidecar via HTTP (localhost) or stdio
- Sidecar manager handles process spawning, lifecycle, and I/O streaming

### Agent Backend: Python (Recommended)

**Why Python:**
- Claude Agent SDK has first-class Python support
- LangGraph, CrewAI, all major agent frameworks are Python-first
- Composio and Nango have Python SDKs
- Fastest iteration speed for agent logic
- Richest ecosystem for LLM tooling

**Why not Rust:** Agent logic changes rapidly during development. Rust's compile times and ownership model slow iteration. The performance-critical parts (Tauri shell, IPC) are already in Rust.

**Why not Go:** Weaker AI/ML ecosystem. Agent frameworks don't have Go SDKs.

**Why not TypeScript/Node:** Claude Agent SDK supports TypeScript, but the Python ecosystem for agent tooling is deeper. TypeScript is better used for the frontend.

### Frontend: TypeScript + React (inside Tauri webview)

- Tauri's webview runs your web frontend
- React for the 4 UI patterns (Tinder, Whiteboard, iMessage, Diff)
- AG-UI TypeScript SDK for real-time agent event streaming
- TailwindCSS for styling

### LLM Inference: API Calls (Recommended for v1)

**Why API over local models:**
- Claude Sonnet/Opus via API delivers far better agent reasoning than local models
- Agent quality is the core product - can't compromise on model quality
- Latency is acceptable with streaming (first token in ~200ms)
- Cost is manageable with budget limits and efficient prompting

**Future consideration:**
- Small local model (e.g., via Ollama) for intent classification only
- Keeps the semantic router fast and offline-capable
- Heavy reasoning stays on API

### IPC Architecture: Tauri <-> Python Agent Backend

```
[Tauri Frontend (React/TS)]
        |
        | Tauri IPC (typed commands)
        v
[Tauri Rust Core]
        |
        | HTTP localhost / stdio pipe
        v
[Python Agent Backend (sidecar)]
        |
        | Claude Agent SDK
        v
[Claude API]
        |
        | MCP
        v
[Composio/Nango -> Gmail, GitHub, etc.]
```

**Option A - HTTP (Recommended):**
- Python backend runs FastAPI server on localhost
- Tauri Rust core makes HTTP requests
- SSE (Server-Sent Events) for streaming agent output back to frontend
- Simple, debuggable, well-understood

**Option B - stdio pipe:**
- Tauri spawns Python as sidecar with stdin/stdout communication
- Lower latency, no port management
- Harder to debug, less tooling support

---

## 6. Recommended Architecture

### High-Level Architecture

```
+----------------------------------------------------------+
|                    Tauri 2.0 Desktop App                  |
|                                                          |
|  +----------------------------------------------------+  |
|  |              Frontend (React + TypeScript)          |  |
|  |                                                    |  |
|  |  +-----------+ +----------+ +--------+ +--------+  |  |
|  |  | Tinder UI | |Whiteboard| |iMessage| | Diff   |  |  |
|  |  | (Batch)   | |(Canvas)  | |(Chat)  | |(Code)  |  |  |
|  |  +-----------+ +----------+ +--------+ +--------+  |  |
|  |                                                    |  |
|  |  +----------------------------------------------+  |  |
|  |  |         AG-UI Event Stream Consumer          |  |  |
|  |  +----------------------------------------------+  |  |
|  +----------------------------------------------------+  |
|                          |                                |
|                    Tauri IPC                               |
|                          |                                |
|  +----------------------------------------------------+  |
|  |              Tauri Rust Core                        |  |
|  |  - Window management                               |  |
|  |  - Sidecar process management                      |  |
|  |  - System tray / global hotkey                     |  |
|  |  - Local storage (SQLite)                          |  |
|  |  - OAuth browser redirect handler                  |  |
|  +----------------------------------------------------+  |
+----------------------------------------------------------+
              |
              | HTTP (localhost) + SSE
              |
+----------------------------------------------------------+
|              Python Agent Backend (Sidecar)               |
|                                                          |
|  +----------------------------------------------------+  |
|  |              FastAPI Server                         |  |
|  |  - POST /intent    (receive user intent)           |  |
|  |  - GET  /stream    (SSE agent events)              |  |
|  |  - POST /approve   (user approval/rejection)       |  |
|  |  - POST /connect   (trigger OAuth flow)            |  |
|  +----------------------------------------------------+  |
|                          |                                |
|  +----------------------------------------------------+  |
|  |           Intent Router                             |  |
|  |  - Semantic similarity (fast path)                 |  |
|  |  - LLM classification (fallback)                   |  |
|  |  - Returns: { agent, ui_pattern, params }          |  |
|  +----------------------------------------------------+  |
|                          |                                |
|  +----------------------------------------------------+  |
|  |         Claude Agent SDK (Agent Loop)               |  |
|  |                                                    |  |
|  |  +------------+  +------------+  +--------------+  |  |
|  |  | Email Agent|  | Code Agent |  | Planning     |  |  |
|  |  | (subagent) |  | (subagent) |  | Agent (sub)  |  |  |
|  |  +------------+  +------------+  +--------------+  |  |
|  |                                                    |  |
|  |  Hooks:                                            |  |
|  |  - PreToolUse  -> approval gate                    |  |
|  |  - PostToolUse -> emit AG-UI events                |  |
|  |  - Stop        -> final result + UI render         |  |
|  +----------------------------------------------------+  |
|                          |                                |
|  +----------------------------------------------------+  |
|  |         Integration Layer (MCP)                     |  |
|  |  - Composio MCP server (Gmail, GitHub, etc.)       |  |
|  |  - Custom MCP tools as needed                      |  |
|  +----------------------------------------------------+  |
+----------------------------------------------------------+
              |
              | API calls
              |
+----------------------------------------------------------+
|                    External Services                      |
|  - Claude API (Anthropic)                                |
|  - Gmail API (via Composio)                              |
|  - GitHub API (via Composio)                             |
+----------------------------------------------------------+
```

### Key Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Desktop framework | Tauri 2.0 | Small, fast, Rust security, sidecar support |
| Agent framework | Claude Agent SDK | Production loop, hooks for approval, MCP, subagents |
| Agent backend language | Python | Best agent framework ecosystem, fastest iteration |
| Frontend | React + TypeScript | Component model for 4 UI patterns, AG-UI SDK |
| Agent-UI protocol | AG-UI | Standard event protocol, human-in-the-loop, streaming |
| Integration platform | Composio (v1) | MCP-native, managed OAuth, pre-built tools |
| Intent routing | Semantic + LLM hybrid | Fast path for common intents, LLM fallback for ambiguous |
| IPC | HTTP localhost + SSE | Simple, debuggable, supports streaming |
| LLM inference | Claude API (cloud) | Agent quality is core product, can't compromise |
| State persistence | SQLite (local) | Desktop-native, no external DB dependency |
| Architecture pattern | Event-driven | Long-running tasks, real-time UI, async approval |

### Implementation Priority for v1

1. **Phase 1 - Foundation:**
   - Tauri app shell with React frontend
   - Python sidecar with FastAPI
   - Basic IPC (HTTP + SSE)
   - Claude Agent SDK integration with simple prompt-response

2. **Phase 2 - Email Agent:**
   - Composio MCP connection for Gmail
   - Email agent (subagent) with draft/reply/send tools
   - iMessage UI pattern
   - Tinder UI pattern for batch email handling
   - PreToolUse hook for send approval

3. **Phase 3 - Code Agent:**
   - Composio MCP connection for GitHub
   - Code agent (subagent) with read/edit/PR tools
   - Diff UI pattern
   - Approval flow for code changes and pushes

4. **Phase 4 - Intelligence Layer:**
   - Intent router (semantic + LLM hybrid)
   - Automatic UI pattern selection
   - Whiteboard UI pattern for planning tasks
   - Session persistence and resume

---

## Sources

### Agent Frameworks
- [CrewAI vs LangGraph vs AutoGen vs OpenAgents (2026)](https://openagents.org/blog/posts/2026-02-23-open-source-ai-agent-frameworks-compared)
- [LangGraph vs CrewAI vs AutoGen: Top 10 AI Agent Frameworks](https://o-mega.ai/articles/langgraph-vs-crewai-vs-autogen-top-10-agent-frameworks-2026)
- [AutoGen vs LangGraph vs CrewAI: Which Actually Holds Up in 2026?](https://dev.to/synsun/autogen-vs-langgraph-vs-crewai-which-agent-framework-actually-holds-up-in-2026-3fl8)
- [A Detailed Comparison of Top 6 AI Agent Frameworks in 2026](https://www.turing.com/resources/ai-agent-frameworks)
- [AI Framework Comparison 2025: OpenAI Agents SDK vs Claude vs LangGraph](https://enhancial.substack.com/p/choosing-the-right-ai-framework-a)
- [Claude Agent SDK vs OpenAI Agents SDK (2026)](https://agentlas.pro/compare/claude-agent-sdk-vs-openai-agents-sdk/)

### Claude Agent SDK
- [How the agent loop works - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/agent-loop)
- [Building Specialised AI Agents using Claude Agent SDK](https://cobusgreyling.medium.com/building-specialised-ai-agents-using-claude-agent-sdk-b4bb8562956e)
- [Claude AI Agents Architecture & Deployment Guide 2026](https://dextralabs.com/blog/claude-ai-agents-architecture-deployment-guide/)

### Integration Platforms
- [Top Composio Alternatives - Nango Blog](https://nango.dev/blog/composio-alternatives)
- [Nango Alternatives for AI Agents - Composio](https://composio.dev/blog/nango-alternatives-ai-agents)
- [Best AI Agent Authentication Platforms 2026 - Nango](https://nango.dev/blog/best-ai-agent-authentication)
- [AI Agent Authentication Platforms Buyer's Guide - Composio](https://composio.dev/blog/ai-agent-authentication-platforms)

### Intent Classification & Routing
- [AI Agent Routing: Tutorial & Best Practices - Patronus AI](https://www.patronus.ai/ai-agent-development/ai-agent-routing)
- [Intent Recognition and Auto-Routing in Multi-Agent Systems](https://gist.github.com/mkbctrl/a35764e99fe0c8e8c00b2358f55cd7fa)
- [Microsoft Multi-Agent Reference Architecture](https://microsoft.github.io/multi-agent-reference-architecture/docs/reference-architecture/Reference-Architecture.html)

### Architecture & Protocols
- [AG-UI: Agent-User Interaction Protocol](https://docs.ag-ui.com/)
- [The Future Architecture: Event-Driven Systems Powered by AI Agents](https://medium.com/@mrschneider/the-future-architecture-event-driven-systems-powered-by-ai-agents-b3cb4f647564)
- [The Future of AI Agents Is Event-Driven - Confluent](https://www.confluent.io/blog/the-future-of-ai-agents-is-event-driven/)
- [LangGraph Human-in-the-Loop Workflows](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)

### Desktop & Tech Stack
- [Tauri vs Electron: Complete Developer's Guide (2026)](https://blog.nishikanta.in/tauri-vs-electron-the-complete-developers-guide-2026)
- [Tauri 2.0 Sidecar - Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
- [Example Tauri v2 Python Server Sidecar](https://github.com/dieharders/example-tauri-v2-python-server-sidecar)
- [Go is the Best Language for AI Agents - Bruin Blog](https://getbruin.com/blog/go-is-the-best-language-for-agents/)
- [Python vs JavaScript vs Go vs Rust in 2026](https://www.nucamp.co/blog/python-vs-javascript-vs-go-vs-rust-in-2026-which-backend-language-should-you-learn)

### Custom vs Framework
- [LangChain, LangGraph, or Custom? Choosing the Right Framework](https://www.turgon.ai/post/langchain-langgraph-or-custom-choosing-the-right-agentic-framework)
- [LangChain vs Custom Workflows - AI Agents Guide 2025](https://www.ampcome.com/post/langchain-vs-custom-workflows-ai-agents-2025)
