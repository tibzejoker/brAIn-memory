# brAIn-memory

Memory-domain nodes for the [brAIn](https://github.com/tibzejoker/brAIn) framework.

| Node | Purpose |
|---|---|
| `memory` | Persistent key-value store with tags + free-text search. |
| `memory-vector` | LanceDB-backed semantic store with Ollama embeddings. |
| `memory-proxy` | Intelligent gateway. Receives `mem.ask` / `mem.store`, fans out to KV + vector, synthesizes a final answer. |
| `memory-consolidator` | Autonomous maintenance — periodically merges duplicates and drops stale entries. |
| `reminder` | Schedules timed reminders. Persists across restarts via `ctx.dataDir`. |

## Install via brAIn-store (recommended)

The brAIn framework auto-installs from the marketplace whenever a seed declares `needs:`:

```yaml
needs:
  - type: memory
  - type: memory-vector
nodes:
  - { type: memory-proxy, name: my-memory }
```

Apply the seed via `POST /network/seeds/<name>/apply` — the framework fetches this repo at the SHA pinned in [tibzejoker/brAIn-store/registry.json](https://github.com/tibzejoker/brAIn-store) and verifies file checksums before registering the types.

## Sister-repo dev mode

If you're hacking on these nodes alongside brAIn:

```
ws/
├── brAIn/
└── brAIn-memory/    ← clone this repo here
```

brAIn's `pnpm-workspace.yaml` already includes `../brAIn-memory/nodes/*` so they auto-link.

## Per-node persistence

Each node owns its own data via `ctx.dataDir` — the framework resolves it to `<root>/data/nodes/<nodeId>/` and creates it on first read. Cross-node data flows over the bus, never via shared filesystems.

## License

MIT.
