# Gateway Architecture

## Purpose

`savant-gateway` exposes a single local API for launching CLI-based model runs and streaming results back to Quorum, Olympus, and other local clients.

## Main flow

- `POST /runs` validates a prompt and selects a provider chain.
- `walkChain()` executes providers in order until one succeeds or the chain fails.
- Each run stores state in an in-memory `Map`.
- SSE clients consume buffered `thinking`, `chunk`, `complete`, and `error` events from that run record.
- `DELETE /runs/:id` kills the active subprocess when one exists.

## Contract points

- `server.js` is the entry point.
- `chain.js` is responsible for provider execution and fallthrough.
- `adapters.js` defines provider metadata, default chain order, and model lists.
- CORS is restricted to local origins.
- The service reports provider availability through `/models` and `/health`.

## Important behavior

- Completed runs are evicted after 10 minutes to avoid unbounded growth.
- `cwd` is passed through to the spawned agent when provided.
- `session_id` is accepted for client correlation but is not required.
- Failed providers should not break the entire chain unless no fallback remains.
