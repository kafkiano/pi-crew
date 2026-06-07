# AGENTS.md — Pi Agent Shell Configuration

This directory (`~/.pi`) is the Pi coding agent's configuration root. It contains extensions, agents, skills, presets, and tools that shape how Pi operates.

## Non-Obvious Issues

### Import Resolution in Extensions

Extensions in `agent/extensions/` import from `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui`. These packages are installed globally (via bun), not locally. Your editor will show "cannot find module" warnings — this is expected. Pi's extension loader (jiti) resolves these at runtime against the global install path.

Do NOT add a local `node_modules` or `package.json` to fix editor warnings. It will break Pi's extension loading.

### Memory System: cuba-memorys

Persistent memory across sessions, backed by PostgreSQL + pgvector. Two layers:

1. **Memory extension** (`agent/extensions/memory/`) — spawns the cuba-memorys binary directly, registers 25 `mem_*` tools plus a `mem` dispatch. Individual tools are callable by name (subagents use them directly). The main agent sees a compact interface: 4 core tools + the `mem` dispatch.
2. **Sub-agents** — `memory-recall`, `memory-verify`, `memory-write`, `memory-admin` each have specific `mem_*` tools assigned via frontmatter. They use the individual tools directly.

Core tools (standalone, always available):
| Tool | Maps to | Purpose |
|------|---------|--------|
| `mem_search` | `cuba_faro` | Search/recall memories |
| `mem_note` | `cuba_cronica` | Attach observations |
| `mem_session` | `cuba_jornada` | Session tracking |
| `mem_errors` | `cuba_expediente` | Search error history |

Dispatch tool (groups 21 operations — use `mem(action, params)` for everything else):
| Action | Maps to | Purpose |
|--------|---------|--------|
| `entity` | `cuba_alma` | CRUD entities |
| `relate` | `cuba_puente` | Create/traverse relations |
| `feedback` | `cuba_eco` | RLHF feedback |
| `decide` | `cuba_decreto` | Record decisions |
| `report` | `cuba_alarma` | Report errors |
| `resolve` | `cuba_remedio` | Resolve errors |
| `contra` | `cuba_contradiccion` | Detect contradictions |
| `analytics` | `cuba_vigia` | Graph analytics |
| `maintenance` | `cuba_zafra` | Decay, prune, merge, reembed |
| `forget` | `cuba_forget` | GDPR hard-delete |
| `gaps` | `cuba_reflexion` | Structural gap analysis |
| `hypothesize` | `cuba_hipotesis` | Abductive inference |
| `trigger` | `cuba_centinela` | Prospective memory triggers |
| `calibrate` | `cuba_calibrar` | Confidence calibration |
| `ingest` | `cuba_ingesta` | Bulk ingestion |
| `project` | `cuba_proyecto` | Project scoping |
| `snapshot` | `cuba_pre_compact` | Compaction survival |
| `sync` | `cuba_sync` | Git-friendly export/import |
| `audit` | `cuba_archivo` | Tamper-evident audit log |
| `buffer` | `cuba_pizarra` | Working memory buffer |
| `judge` | `cuba_juez` | LLM-judge for conflicts |

All 25 individual `mem_*` tools remain registered and callable by name (subagents use them via `--tools`). The main agent's prompt only shows the 4 core + `mem` dispatch unless a preset overrides.

### Search Tool

The `search` tool wraps `search/search.sh` — a BM25-scored code search with subword tokenization. It ranks results by relevance (not just text match), handles camelCase/snake_case splitting, and supports context lines.

Prefer `search` over raw `grep` for codebase exploration. Use `mode=files` to find relevant files, then `read` them.

### Presets

Presets configure model + thinking level + tools + instructions as a named unit. Defined in `agent/presets.json`. Activate via `--preset <name>`, `/preset` command, or `Ctrl+Shift+U` to cycle.

Current presets:
- `architect` — mimo-v2.5-pro, high thinking, read-only tools, analysis instructions
- `coder` — mimo-v2.5-pro, high thinking, read+write tools, implementation instructions

Instructions reference `.md` files in `agent/instructions/`. These are resolved relative to `getAgentDir()` at load time.

### Memory Monitor

The `memory-monitor` extension nudges every N turns (default: 10) to archive learnings to cuba-memorys. It also auto-compacts at 80% context usage. Toggle with `/mem`.

### Filter Output

The `filter-output` extension redacts sensitive data (API keys, tokens, passwords, connection strings) from tool results before the LLM sees them. It also blocks reads of sensitive files (`.env`, `secrets.json`, etc.).

### Sub-Agents

Sub-agents are defined in `agent/agents/`. Each has a `.md` file with frontmatter (name, description, model, tools) and instructions. They are invoked via the `subagent` tool with `agent=<name>`.

Available agents:
- `memory-recall`, `memory-verify`, `memory-write`, `memory-admin` — Memory operations
- `coder` — Senior programmer, implements the architect's plan
- `tester` — Runs tests, type checks, linters. Reports results without modifying code
- `scout` — Codebase exploration, context gathering
- `worker` — General-purpose, full capabilities (fallback)

### Custom Ripgrep

A custom `rg` binary lives in `agent/bin/rg`. Pi uses this for its built-in grep tool.

## Directory Structure

```
~/.pi/
├── AGENTS.md              ← This file (loaded as context)
├── README.md              ← Project overview
├── agent/
│   ├── agents/            ← Sub-agent definitions (.md)
│   ├── extensions/        ← TypeScript extensions
│   │   ├── search/        ← BM25 code search tool
│   │   ├── memory/        ← Memory tools (mem_* wrappers for cuba-memorys)
│   │   ├── memory-monitor.ts ← Turn-based memory nudges
│   │   ├── filter-output.ts  ← Sensitive data redaction
│   │   └── preset.ts      ← Named configuration presets
│   ├── instructions/      ← Preset instruction files
│   ├── prompts/           ← Prompt templates
│   ├── bin/               ← Custom binaries (rg)
│   ├── settings.json      ← Global settings
│   ├── models.json        ← Custom provider/model definitions
│   ├── presets.json        ← Preset configurations
│   ├── mcp.json           ← MCP server configurations
│   └── .gitignore         ← Excludes auth, sessions, logs
└── search/
    ├── search.sh          ← BM25 code search (bash+awk)
    └── README.md          ← Search script documentation
```

## Conventions

- Extensions use `defineTool()` from `@earendil-works/pi-coding-agent` for tool registration
- Extensions use `Type` from `@earendil-works/pi-ai` for parameter schemas
- Preset instructions live in `agent/instructions/*.md` and are referenced by path in `presets.json`
- Sub-agent definitions use YAML frontmatter + markdown body
- Memory tools use `mem_*` prefix (registered by memory extension). Use `mem(action, params)` dispatch for non-core operations.
