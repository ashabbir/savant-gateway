# Graph Report - ../savant-gateway  (2026-06-16)

## Corpus Check
- 7 files · ~2,957 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 66 nodes · 80 edges · 8 communities (7 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1c1ecd73`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]

## God Nodes (most connected - your core abstractions)
1. `savant-gateway` - 9 edges
2. `API Documentation` - 7 edges
3. `walkChain()` - 6 edges
4. `buildChildEnv()` - 3 edges
5. `isQuotaError()` - 3 edges
6. `ADAPTERS` - 3 edges
7. `DEFAULT_CHAIN` - 3 edges
8. `buildArgv()` - 3 edges
9. `scripts` - 3 edges
10. `spawnAgent()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `walkChain()` --calls--> `spawnAgent()`  [EXTRACTED]
  chain.js → runner.js
- `walkChain()` --calls--> `isQuotaError()`  [EXTRACTED]
  chain.js → adapters.js
- `walkChain()` --calls--> `buildArgv()`  [EXTRACTED]
  chain.js → adapters.js

## Import Cycles
- None detected.

## Communities (8 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.19
Nodes (12): ADAPTERS, buildArgv(), isQuotaError(), { ADAPTERS, DEFAULT_CHAIN, isQuotaError, buildArgv }, fs, ISOLATED_CWD_PROVIDERS, os, path (+4 more)

### Community 1 - "Community 1"
Cohesion: 0.22
Nodes (9): ALL_PROVIDER_NAMES, buildChildEnv(), DISABLED_PROVIDERS, EXTRA_PATH_DIRS, isCommandAvailable(), os, path, QUOTA_PATTERNS (+1 more)

### Community 2 - "Community 2"
Cohesion: 0.20
Nodes (8): DEFAULT_CHAIN, PROVIDER_NAMES, { ADAPTERS, DEFAULT_CHAIN, PROVIDER_NAMES, DISABLED_PROVIDERS }, app, express, { randomUUID }, runs, { walkChain }

### Community 3 - "Community 3"
Cohesion: 0.20
Nodes (9): dependencies, express, description, main, name, scripts, dev, start (+1 more)

### Community 4 - "Community 4"
Cohesion: 0.22
Nodes (8): Configuration, Features, Installation, License, Prerequisites, savant-gateway, Service Management, Supported Providers

### Community 5 - "Community 5"
Cohesion: 0.29
Nodes (7): API Documentation, `DELETE /runs/:id`, `GET /health`, `GET /models`, `GET /runs/:id`, `GET /runs/:id/stream`, `POST /runs`

### Community 6 - "Community 6"
Cohesion: 0.40
Nodes (4): { buildChildEnv }, os, { spawn }, spawnAgent()

## Knowledge Gaps
- **43 isolated node(s):** `os`, `path`, `{ spawnSync }`, `EXTRA_PATH_DIRS`, `QUOTA_PATTERNS` (+38 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `savant-gateway` connect `Community 4` to `Community 5`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `API Documentation` connect `Community 5` to `Community 4`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `walkChain()` connect `Community 0` to `Community 2`, `Community 6`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `os`, `path`, `{ spawnSync }` to the rest of the system?**
  _43 weakly-connected nodes found - possible documentation gaps or missing edges._