# Graph Report - savant-gateway  (2026-07-19)

## Corpus Check
- 18 files · ~6,044 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 138 nodes · 161 edges · 15 communities (12 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `00d87083`
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
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]

## God Nodes (most connected - your core abstractions)
1. `savant-gateway` - 9 edges
2. `API Documentation` - 8 edges
3. `walkChain()` - 7 edges
4. `buildArgv()` - 5 edges
5. `Gateway Architecture` - 5 edges
6. `Gateway Runtime` - 5 edges
7. `buildChildEnv()` - 4 edges
8. `scripts` - 4 edges
9. `Gateway Testing and Quality` - 4 edges
10. `isQuotaError()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `walkChain()` --calls--> `buildArgv()`  [EXTRACTED]
  chain.js → adapters.js
- `walkChain()` --calls--> `isQuotaError()`  [EXTRACTED]
  chain.js → adapters.js
- `walkChain()` --calls--> `spawnAgent()`  [EXTRACTED]
  chain.js → runner.js

## Import Cycles
- None detected.

## Communities (15 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.13
Nodes (17): ADAPTERS, DEFAULT_CHAIN, isQuotaError(), { ADAPTERS, DEFAULT_CHAIN, isQuotaError, buildArgv }, fs, invalidResponse(), ISOLATED_CWD_PROVIDERS, os (+9 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (22): ALL_PROVIDER_NAMES, buildArgv(), buildChildEnv(), DISABLED_PROVIDERS, discoverAgyModels(), discoverCodexModels(), discoverHermesModels(), EXTRA_PATH_DIRS (+14 more)

### Community 2 - "Community 2"
Cohesion: 0.15
Nodes (10): PROVIDER_NAMES, { ADAPTERS, DEFAULT_CHAIN, PROVIDER_NAMES, DISABLED_PROVIDERS, scheduleModelRefresh }, app, executeRun(), express, { randomUUID }, runs, steeringPrompt() (+2 more)

### Community 3 - "Community 3"
Cohesion: 0.17
Nodes (11): dependencies, express, multer, description, main, name, scripts, dev (+3 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (16): API Documentation, Configuration, `DELETE /runs/:id`, Features, `GET /health`, `GET /models`, `GET /runs/:id`, `GET /runs/:id/stream` (+8 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (13): assert, { buildPromptWithFiles, safeFilename }, path, test, buildPromptWithFiles(), cleanupFiles(), fs, multer (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.33
Nodes (5): Contract points, Gateway Architecture, Important behavior, Main flow, Purpose

### Community 8 - "Community 8"
Cohesion: 0.33
Nodes (5): Gateway Runtime, Local dependencies, Logging and storage, Operational notes, Startup

### Community 9 - "Community 9"
Cohesion: 0.40
Nodes (4): raceChain(), assert, { raceChain }, test

### Community 10 - "Community 10"
Cohesion: 0.40
Nodes (4): Common regressions, Gateway Testing and Quality, Verification commands, What to verify

### Community 11 - "Community 11"
Cohesion: 0.50
Nodes (3): Current state, Read order, Savant Gateway Memory Bank

### Community 12 - "Community 12"
Cohesion: 0.50
Nodes (3): Decision, Gateway speed, uploads, and steering design, Guardrails

## Knowledge Gaps
- **81 isolated node(s):** `os`, `path`, `fs`, `{ spawnSync }`, `EXTRA_PATH_DIRS` (+76 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `buildPromptWithFiles()` connect `Community 5` to `Community 2`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **What connects `os`, `path`, `fs` to the rest of the system?**
  _81 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.13450292397660818 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.10869565217391304 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._