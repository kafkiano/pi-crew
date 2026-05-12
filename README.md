# Pi Agent Shell

A customized [Pi coding agent](https://pi.dev) configuration with persistent memory, BM25 code search, named presets, and security hardening.

## Features

### Persistent Memory (cuba-memorys)

Cross-session memory via a neuroscience-inspired MCP server. Stores facts, decisions, lessons, and errors as a knowledge graph with Hebbian learning and automatic decay.

Memory operations are delegated to three specialized sub-agents:
- **memory-recall** — Retrieves relevant context before answering
- **memory-verify** — Grounds claims against stored knowledge
- **memory-write** — Consolidates learnings at natural breakpoints

The **memory-monitor** extension nudges every 10 turns to archive findings, and auto-compacts at 80% context usage.

### BM25 Code Search

A `search` tool that wraps a ~480-line bash+awk script implementing Okapi BM25 scoring with subword tokenization. Unlike raw grep:

- **Ranks by relevance** — rare terms weigh more than common ones (IDF)
- **Splits identifiers** — `getUserAuthToken` matches a query for "user auth"
- **Code-aware boundaries** — `expose` matches `exposeTranslations` but not `exposure`
- **Path priors** — downweights tests, docs, fixtures, minified files
- **Context lines** — optional surrounding lines for code understanding

```
search({ query: "authentication middleware", context: 2, mode: "files" })
```

### Named Presets

Switch between model + thinking level + tool set + instructions as a unit.

| Preset | Model | Thinking | Tools | Purpose |
|--------|-------|----------|-------|---------|
| `architect` | mimo-v2.5-pro | high | read-only | Analysis, planning, code review |
| `coder` | mimo-v2.5-pro | high | read+write | Implementation, debugging |

Activate via `--preset <name>`, `/preset` command, or `Ctrl+Shift+U` to cycle.

### Security

The **filter-output** extension redacts sensitive data before the LLM sees it:
- API keys (OpenAI, GitHub, Slack, AWS)
- Connection strings (PostgreSQL, MongoDB, MySQL, Redis)
- Private keys, bearer tokens, passwords
- Blocks reads of `.env`, `secrets.json`, and similar files

### Sub-Agents

Specialized agents for specific tasks, invoked via the `subagent` tool:

| Agent | Purpose |
|-------|---------|
| `memory-recall` | Retrieve persistent memories |
| `memory-verify` | Verify claims against knowledge graph |
| `memory-write` | Consolidate learnings |
| `coder` | Senior programmer, implements the architect's plan |
| `tester` | Runs tests, type checks, linters |
| `scout` | Codebase exploration |
| `worker` | General-purpose fallback |

## Extensions

| Extension | Purpose |
|-----------|---------|
| `search.ts` | BM25 code search tool |
| `memory-monitor.ts` | Turn-based memory nudges + auto-compaction |
| `filter-output.ts` | Sensitive data redaction |
| `preset.ts` | Named configuration presets |

## Configuration

| File | Purpose |
|------|---------|
| `settings.json` | Global Pi settings (model, thinking level, packages) |
| `models.json` | Custom provider/model definitions |
| `presets.json` | Named preset configurations |
| `mcp.json` | MCP server configurations |

## Directory Structure

```
~/.pi/
├── agent/
│   ├── agents/            # Sub-agent definitions
│   ├── extensions/        # TypeScript extensions
│   ├── instructions/      # Preset instruction files
│   ├── prompts/           # Prompt templates
│   ├── bin/               # Custom binaries (ripgrep)
│   └── settings.json      # Global settings
└── search/
    └── search.sh          # BM25 code search script
```

## Requirements

- [Pi coding agent](https://pi.dev) (`npm install -g @earendil-works/pi-coding-agent`)
- [Bun](https://bun.sh) (for package management)
- PostgreSQL + pgvector (for cuba-memorys, optional)
- GNU grep (for search.sh)
