# AGENTS.md — Pi Agent Shell Configuration

This directory (`~/.pi`) is the Pi coding agent's configuration root. It contains extensions, agents, skills, presets, and tools that shape how Pi operates.

## Non-Obvious Issues

### Import Resolution in Extensions

Extensions in `agent/extensions/` import from `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui`. These packages are installed globally (via bun), not locally. Your editor will show "cannot find module" warnings — this is expected. Pi's extension loader (jiti) resolves these at runtime against the global install path.

Do NOT add a local `node_modules` or `package.json` to fix editor warnings. It will break Pi's extension loading.

### Memory System: cuba-memorys

Persistent memory across sessions, backed by PostgreSQL + pgvector. Two layers:

1. **Memory extension** (`agent/extensions/memory/`) — spawns the cuba-memorys binary directly, registers `mem_*` tools with clean names. These are the primary interface.
2. **MCP adapter** (`agent/mcp.json`) — lazy connection for advanced/non-core tools (analytics, maintenance, bulk ingestion). Accessed via `mcp({ tool: "cuba_*" })` proxy.

Core tools (via extension):
| Tool | Maps to | Purpose |
|------|---------|--------|
| `mem_search` | `cuba_faro` | Search/recall memories |
| `mem_note` | `cuba_cronica` | Attach observations |
| `mem_entity` | `cuba_alma` | CRUD entities |
| `mem_relate` | `cuba_puente` | Create/traverse relations |
| `mem_feedback` | `cuba_eco` | RLHF feedback |
| `mem_session` | `cuba_jornada` | Session tracking |
| `mem_decide` | `cuba_decreto` | Record decisions |
| `mem_errors` | `cuba_expediente` | Search error history |
| `mem_report` | `cuba_alarma` | Report errors |
| `mem_resolve` | `cuba_remedio` | Resolve errors |
| `mem_contra` | `cuba_contradiccion` | Detect contradictions |
| `mem_analytics` | `cuba_vigia` | Graph analytics |
| `mem_maintenance` | `cuba_zafra` | Decay, prune, merge, reembed |
| `mem_forget` | `cuba_forget` | GDPR hard-delete |
| `mem_gaps` | `cuba_reflexion` | Structural gap analysis |
| `mem_hypothesize` | `cuba_hipotesis` | Abductive inference |
| `mem_trigger` | `cuba_centinela` | Prospective memory triggers |
| `mem_calibrate` | `cuba_calibrar` | Confidence calibration |
| `mem_ingest` | `cuba_ingesta` | Bulk ingestion |
| `mem_project` | `cuba_proyecto` | Project scoping |
| `mem_snapshot` | `cuba_pre_compact` | Compaction survival |
| `mem_sync` | `cuba_sync` | Git-friendly export/import |
| `mem_audit` | `cuba_archivo` | Tamper-evident audit log |
| `mem_buffer` | `cuba_pizarra` | Working memory buffer |
| `mem_judge` | `cuba_juez` | LLM-judge for conflicts |

Memory operations are delegated to three sub-agents: `memory-recall`, `memory-verify`, `memory-write`. They each have specific `mem_*` tools assigned via frontmatter.

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
- `memory-recall`, `memory-verify`, `memory-write` — Memory operations (MCP only)
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
- Memory tools use `mem_*` prefix (registered by memory extension, not MCP adapter)
- Advanced memory tools accessed via `mcp({ tool: "cuba_*" })` proxy
