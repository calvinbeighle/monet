## Build & Run

- Dev server: `npm run dev`
- Production build: `npm run build`
- Preview production build: `npm run preview`

## Validation

Run these after implementing to get immediate feedback:

- Tests: `npm run test`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`

## Operational Notes

- Vite + React + TypeScript project scaffolded with PixiJS, Zustand, React Query, Tailwind v4
- Tailwind v4 uses `@import "tailwindcss"` in CSS (no tailwind.config.js needed)
- Vitest configured with jsdom environment and @testing-library/react
- Path alias `@/` maps to `src/`
- Canvas getContext() warnings in tests are expected (jsdom limitation) - harmless

### Codebase Patterns

- Types in `src/lib/types/` - re-exported from index.ts barrel
- Zustand stores in `src/lib/stores/` - re-exported from index.ts barrel
- Feature modules in `src/features/{map,threads,agents,sync,auth,game-mechanics}/`
- Shell components in `src/components/`
- Named exports only (no default exports except where framework requires)
