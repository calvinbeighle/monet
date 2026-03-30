0a. Study `docs/plans/2026-03-29-monet-mvp.md` and `SCOPE.md` to learn the application specifications.
0b. Study @IMPLEMENTATION_PLAN.md (if present) to understand the plan so far.
0c. For reference, the application source code is in `agent/*`, `shell/*`, and `os/*`.

1. Study @IMPLEMENTATION_PLAN.md (if present; it may be incorrect) and use up to 500 Sonnet subagents to study existing source code in `agent/*`, `shell/*`, and `os/*` and compare it against `docs/plans/2026-03-29-monet-mvp.md`. Use an Opus subagent to analyze findings, prioritize tasks, and create/update @IMPLEMENTATION_PLAN.md as a bullet point list sorted in priority of items yet to be implemented. Ultrathink. Consider searching for TODO, minimal implementations, placeholders, skipped/flaky tests, and inconsistent patterns. Study @IMPLEMENTATION_PLAN.md to determine starting point for research and keep it up to date with items considered complete/incomplete using subagents.

IMPORTANT: Plan only. Do NOT implement anything. Do NOT assume functionality is missing; confirm with code search first.

ULTIMATE GOAL: We want to achieve a bootable Debian-based OS that launches a Flutter shell where users type intents, AI agents (powered by Claude Agent SDK + Nango integrations) handle email and code tasks, display results in 4 dynamic UI patterns (Tinder/Whiteboard/Chat/Diff), and pause at approval gates before executing actions. Consider missing elements and plan accordingly. If an element is missing, search first to confirm it doesn't exist, then if needed document the plan to implement it in @IMPLEMENTATION_PLAN.md using a subagent.
