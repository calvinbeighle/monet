## Build & Run

- Dev server: `npm run dev`
- Production build: `npm run build`
- Port: default Vite (5173)

## Validation

Run these after implementing to get immediate feedback:

- Tests: `npm run test` (Vitest, 48 passing)
- Typecheck: `npm run typecheck` (TypeScript strict mode)
- Lint: `npm run lint` (ESLint)

## Operational Notes

- IndexedDB persistence uses `idb` library with split-ownership merge pattern
- Zustand stores use `Map<string, T>` with immutable updates (new Map on each mutation)
- All type imports must use `import type` (verbatimModuleSyntax enabled)
- Path alias: `@/` maps to `src/`

### Codebase Patterns

- Activity ID format: `{source}:{sourceId}` (e.g. `gmail:abc123`)
- Factory functions: `createActivity()`, `createWorkstream()` for defaults
- Two-dimensional shell state: AuthState x DataState (orthogonal)
- Workstream lifecycle: active -> stale (7d) -> archived (30d)
