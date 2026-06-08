# savant-gateway

Host-native AI provider gateway for the Savant ecosystem.

`savant-gateway` is a lightweight Node.js service that acts as a unified bridge between local AI CLI agents and the Savant ecosystem (like Quorum and savant-client). It provides a REST API to trigger AI runs, supports automatic failover between multiple providers, and streams thinking steps and response chunks via Server-Sent Events (SSE).

## Features

- **Unified API**: Single interface for multiple AI CLI agents: Claude, Copilot, Codex, Gemini, and AGY.
- **Failover Chaining**: Automatically falls back to the next provider in the chain if the primary hits a quota or fails.
- **SSE Streaming**: Real-time streaming of thinking steps, status updates, and response chunks.
- **Host-Native Execution**: Spawns agents directly on your machine, leveraging your local credentials and environment.
- **macOS Integration**: Easy installation as a `launchd` background service.
- **Security**: Bound to `127.0.0.1` and restricted to local origins by default.

## Supported Providers

The gateway probes your `PATH` for the following CLI tools:

| Provider | CLI Command | Notes |
| :--- | :--- | :--- |
| **Claude** | `claude` | Anthropic's official CLI. |
| **Copilot** | `copilot` | GitHub Copilot CLI. |
| **Codex** | `codex` | Codex CLI agent. |
| **Gemini** | `gemini` | Google Gemini CLI. |
| **AGY** | `agy` | AGY CLI agent. |

## Prerequisites

- **Node.js**: Version 18 or later is recommended.
- **macOS**: Required for the `launchd` installation script.
- **CLI Agents**: One or more of the supported CLI agents must be installed and authenticated in your environment.

## Installation

Run the provided installation script to set up the service as a macOS LaunchAgent:

```bash
./install.sh
```

This script will:
1. Install dependencies (`npm install`).
2. Generate a `launchd` plist (`com.savant.gateway.plist`) from the template.
3. Register and start the service.
4. Verify the service is healthy.

By default, the gateway listens on `http://127.0.0.1:3100`.

## API Documentation

### `POST /runs`
Starts a new AI run.

**Request Body:**
```json
{
  "prompt": "Write a hello world in Rust",
  "chain": [
    { "provider": "claude", "model": "sonnet" },
    { "provider": "gemini", "model": "gemini-2.0-flash" }
  ],
  "cwd": "/path/to/workdir"
}
```
- `prompt` (required): The prompt string.
- `chain` (optional): An array of provider steps to try in order. Defaults to a pre-defined fallback chain.
- `cwd` (optional): The working directory for the spawned agent.

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running"
}
```

### `GET /runs/:id/stream`
Connect via Server-Sent Events (SSE) to receive real-time updates for a run.

**Events:**
- `thinking`: Updates on which provider is being attempted and its status.
- `chunk`: Incremental response tokens/chunks.
- `complete`: The final full response and provider metadata.
- `error`: Error messages if the run fails.

### `GET /runs/:id`
Poll for the current status and result of a run.

### `DELETE /runs/:id`
Kill an in-flight run.

### `GET /models`
List all supported providers and their available models, including whether they are currently enabled on your system.

### `GET /health`
Returns service status, uptime, and active providers.

## Configuration

The gateway can be configured using environment variables:

- `GATEWAY_PORT`: The port to listen on (default: `3100`).

## Service Management

The service is managed by `launchd`. You can use `launchctl` to control it:

- **Start**: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.savant.gateway.plist`
- **Stop**: `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.savant.gateway.plist`
- **Restart**: `launchctl kickstart -k gui/$(id -u)/com.savant.gateway`
- **Logs**: Logs are written to `~/.savant/gateway.log`.

## License

MIT
