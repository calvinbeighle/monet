## Build & Run

### Agent Backend (Python)

```bash
cd agent
pip install -r requirements.txt
uvicorn agent.main:app --host 0.0.0.0 --port 8000
```

### Flutter Shell

```bash
cd shell
flutter pub get
flutter run -d macos    # Development
flutter build linux     # Production (aarch64)
```

### Tests

```bash
python3 -m pytest agent/tests/ -v
cd shell && flutter test
```

## Validation

Run these after implementing to get immediate feedback:

- Tests: `python3 -m pytest agent/tests/ -v`
- Flutter tests: `cd shell && flutter test`
- Typecheck: `cd shell && dart analyze`

## Operational Notes

- Agent backend runs on port 8000, Flutter shell connects to localhost:8000
- SQLite databases stored in /var/lib/monet/ (VM) or local project dir (dev)
- Nango handles OAuth for Gmail and GitHub integrations
- `python` is not available on this system - always use `python3`
- Agent backend requires `ANTHROPIC_API_KEY` environment variable for live usage (tests mock the API)

### Codebase Patterns

- Agent backend: Python + FastAPI in `agent/`
- Flutter shell: Dart in `shell/lib/`
- OS customization: shell scripts in `os/`
- Specs/plans: `docs/plans/` and `SCOPE.md`
