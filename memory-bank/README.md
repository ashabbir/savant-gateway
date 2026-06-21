# Savant Gateway Memory Bank

This directory captures the operating contract for the gateway that sits between local AI CLI tools and Savant apps.

## Read order

1. `architecture.md` - process model, run lifecycle, and provider chaining.
2. `runtime.md` - startup, ports, logging, and service management.
3. `testing-and-quality.md` - verification commands and behavioral checks.
4. `agent-playbook.md` - safe edit rules and common failure modes.

## Current state

- The service is a small Express app in `server.js`.
- Default bind address is `127.0.0.1:3100`.
- Runs are kept in memory and evicted after completion.
- SSE is the primary streaming path for agent output.
- Provider availability is detected from local CLI tools on `PATH`.

Update these notes when the run contract, provider list, streaming behavior, or startup flow changes.
