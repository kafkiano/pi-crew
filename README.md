# Pi Agent Shell

A customized [Pi coding agent](https://pi.dev) configuration with persistent memory, BM25 code search, named presets, sub-agent delegation, and security hardening.

## Features

### Persistent Memory (cuba-memorys)

Cross-session memory via a neuroscience-inspired MCP server backed by PostgreSQL + pgvector. Stores facts, decisions, lessons, and errors as a knowledge graph with Hebbian learning and automatic decay.

25 `mem_*` tools are registered by the `memory/` extension. The main agent sees a compact interface: 4 core tools (`mem_search`, `mem_note`, `mem_session`, `mem_errors`) plus a `mem` dispatch for the remaining 21 operations.

Memory operations are delegated to four specialized sub-agents:
- **memory-recall** — Retrieves relevant context before answering
- **memory-verify** — Grounds claims against stored knowledge
- **memory-write** — Consolidates learnings at natural breakpoints
- **memory-admin** — Knowledge graph health, maintenance, and introspection

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
| `architect` | deepseek-v4-pro | xhigh | read-only | Analysis, planning, code review |
| `coder` | glm-5.1 | high | read+write | Implementation, debugging |

Activate via `--preset <name>`, `/preset` command, or `Ctrl+Shift+U` to cycle.

### Security

The **filter-output** extension redacts sensitive data before the LLM sees it:
- API keys (OpenAI, GitHub, Slack, AWS)
- Connection strings (PostgreSQL, MongoDB, MySQL, Redis)
- Private keys, bearer tokens, passwords
- Blocks reads of `.env`, `secrets.json`, and similar files

### Sub-Agents

Specialized agents with isolated context windows, invoked via the `subagent` tool. Defined in `agent/agents/` as markdown files with YAML frontmatter.

| Agent | Purpose |
|-------|---------|
| `architect` | Systems architect — analysis, research, plans |
| `coder` | Senior programmer — implements with surgical precision |
| `tester` | Runs tests, type checks, linters — reports without modifying |
| `memory-recall` | Retrieve persistent memories |
| `memory-verify` | Verify claims against knowledge graph |
| `memory-write` | Consolidate learnings |
| `memory-admin` | Knowledge graph health, maintenance, introspection |

## Extensions

| Extension | Purpose |
|-----------|---------|
| `search/` | BM25 code search tool (~480-line bash+awk) |
| `memory/` | Memory tools — spawns cuba-memorys, registers 25 `mem_*` tools + dispatch |
| `subagent/` | Agent delegation — isolated contexts, parallel/chained execution |
| `edit/` | File editing with exact text replacement |
| `filter-output.ts` | Sensitive data redaction |
| `preset.ts` | Named configuration presets |
| `temperature.ts` | Per-model temperature injection |

10 additional extensions are loaded from the global Pi install (`settings.json`):
`permission-gate`, `confirm-destructive`, `todo`, `handoff`, `model-status`,
`session-name`, `bookmark`, `notify`, `prompt-customizer`, `question`.

## Skills

Reusable instruction sets loaded dynamically for specific tasks:

| Skill | Purpose |
|-------|---------|
| `memory` | Persistent memory best practices |
| `orchestrate` | Multi-agent orchestration (architect → coder → tester) |
| `cdp-cli` | Browser automation via Chrome DevTools Protocol |
| `librarian` | Evidence-backed open-source library research with GitHub citations |

## Packages

Third-party packages installed in `agent/npm/`:

| Package | Purpose |
|---------|---------|
| `pi-web-access` | Web search, content fetching, YouTube transcripts |
| `pi-ollama-cloud` | Ollama Cloud provider integration |

## Configuration

| File | Purpose |
|------|---------|
| `settings.json` | Global Pi settings (model, thinking level, packages) |
| `presets.json` | Named preset configurations |

## Directory Structure

```
~/.pi/
├── README.md
├── AGENTS.md
├── agent/
│   ├── agents/            # Sub-agent definitions (.md)
│   ├── extensions/        # TypeScript extensions
│   │   ├── search/        # BM25 code search
│   │   ├── memory/        # Memory tools (cuba-memorys)
│   │   ├── subagent/      # Agent delegation
│   │   ├── edit/          # File editing
│   │   ├── filter-output.ts  # Sensitive data redaction
│   │   ├── preset.ts      # Named configuration presets
│   │   └── temperature.ts # Per-model temperature injection
│   ├── instructions/      # Preset instruction files
│   ├── prompts/           # Prompt templates
│   ├── skills/            # Skill definitions
│   ├── npm/               # Third-party packages
│   ├── bin/               # Custom binaries (ripgrep)
│   ├── settings.json      # Global settings
│   ├── presets.json       # Preset configurations
│   └── temperature.json   # Model temperature overrides
└── sessions/              # Session logs
```

## Requirements

- [Pi coding agent](https://pi.dev) (`npm install -g @earendil-works/pi-coding-agent`)
- [Bun](https://bun.sh) (for package management and extension loading)
- PostgreSQL + pgvector (for cuba-memorys, optional)
- GNU grep (for search.sh)
