# Gateway speed, uploads, and steering design

## Decision

Keep the existing REST/SSE contract and add three compatible capabilities:

1. Accept `multipart/form-data` on `POST /runs` with `prompt`, optional JSON
   `chain`, and up to 10 `files`. Stage uploads in a private per-run directory,
   expose their absolute paths in the agent prompt, and remove them at the end.
2. Race a bounded number of provider subprocesses for default chains. The first
   valid response wins; all losing subprocesses are killed. Explicit clients can
   request serial mode when provider ordering matters more than latency.
3. Cache slow local model discovery instead of synchronously probing CLIs on
   every health request. Refresh in the background with a short TTL.

Steering remains cancel-and-restart because the supported one-shot CLIs do not
share a safe interactive stdin protocol. Cancellation must kill every active
provider attempt before starting the steered generation.

## Guardrails

- Bind to localhost as before.
- Limit uploads by count and bytes; sanitize filenames and never trust a client
  supplied destination path.
- Bound parallelism to avoid unbounded process and provider usage.
- Keep event output provider-tagged and do not leak chunks from losing racers.
