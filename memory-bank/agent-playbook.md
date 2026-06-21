# Gateway Agent Playbook

- Read `server.js`, `chain.js`, and `adapters.js` before changing behavior.
- Prefer small edits that preserve the existing run contract.
- Do not replace the in-memory run store without checking the client expectations first.
- Keep the local-only network boundary intact unless the user explicitly asks otherwise.
- When adding a provider, update adapter metadata, chain selection, and the health/model surfaces together.
- If a change affects SSE, verify both live streaming and late-join consumers.

## Safe edit order

1. Update adapter or chain logic.
2. Update the `/models` and `/health` output if needed.
3. Verify run state and SSE behavior.
4. Refresh this memory bank if the contract changed.
