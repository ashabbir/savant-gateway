# Gateway Testing and Quality

## Verification commands

- `npm start` for a basic boot check.
- `npm run dev` while editing the server.
- Exercise `GET /health` and `GET /models` after startup.
- Exercise `POST /runs` with a short prompt and confirm SSE output on `/runs/:id/stream`.

## What to verify

- The gateway binds only to localhost.
- Providers are discovered from the host `PATH`.
- Run lifecycle transitions are correct: `running` -> `complete`, `error`, or `killed`.
- SSE consumers receive buffered events even if they connect after the run starts.
- `DELETE /runs/:id` stops active work without crashing the process.

## Common regressions

- Provider adapters becoming unavailable because the CLI is missing or unauthenticated.
- Broken chain fallback when a provider fails early.
- CORS or headers preventing the local Electron apps from reaching the service.
- Event buffering bugs that cause SSE clients to miss the final state.
