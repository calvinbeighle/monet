## Build & Run

- Dev server: `npm run dev`
- Production build: `npm run build`
- Port: default Vite (5173)

## Validation

Run these after implementing to get immediate feedback:

- Tests: `npm run test` (Vitest, 56 passing)
- Typecheck: `npm run typecheck` (TypeScript strict mode)
- Lint: `npm run lint` (ESLint)

## Operational Notes

- IndexedDB persistence uses `idb` library with split-ownership merge pattern
- Zustand stores use `Map<string, T>` with immutable updates (new Map on each mutation)
- All type imports must use `import type` (verbatimModuleSyntax enabled)
- Path alias: `@/` maps to `src/`
- CSS variables: `--font-display` (Playfair Display) and `--font-body` (Crimson Text) - not `--font-mono`/`--font-serif`
- xAI Imagine API: requires `XAI_API_KEY` env var on backend. Key in 1Password ("xAI API Key", credential field). Frontend handles missing images gracefully.

### Codebase Patterns

- Activity ID format: `{source}:{sourceId}` (e.g. `gmail:abc123`)
- Factory functions: `createActivity()`, `createWorkstream()` for defaults
- Two-dimensional shell state: AuthState x DataState (orthogonal)
- Workstream lifecycle: active -> stale (7d) -> archived (30d)

### CRITICAL: Architecture

**Two layers:**

1. **Backend = real terminal emulator** - WebSocket PTY server spawning real shell processes. Runs agents (claude CLI, scripts, builds). Full process lifecycle management. Extend `../agent/main.py` or standalone.
2. **Frontend = TikTok feed with generated videos** - Full-viewport snap-scroll. Each card shows a rich visual "video" of what the workstream agent is doing (animated, cinematic, NOT raw terminal text). Use the Imagine library for AI-generated visuals. Detail view expands to show the real terminal (xterm.js) for direct interaction.
3. **DO NOT call store methods inside Zustand selectors** - causes infinite loops. Use raw state + useMemo.
4. **UI snap-scroll** - `scroll-snap-type: y mandatory`. ONE workstream per screen.
