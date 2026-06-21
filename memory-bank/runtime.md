# Gateway Runtime

## Startup

- Start the service with `npm start`.
- Use `npm run dev` for `node --watch server.js`.
- The server listens on `127.0.0.1` and defaults to port `3100`.

## Local dependencies

- Node.js 18+.
- One or more CLI providers installed and authenticated on the host machine.

## Operational notes

- The gateway is intentionally host-native; it uses the local shell environment rather than a remote worker.
- SSE connections should be kept open until the run reaches a terminal state.
- The `/health` endpoint is the fastest way to confirm provider discovery.
- The `/models` endpoint is useful when debugging provider support or disabled adapters.

## Logging and storage

- Runtime state is in memory only.
- Completed runs are removed automatically.
- Any persistent logs should be handled by the surrounding service manager or wrapper script.
