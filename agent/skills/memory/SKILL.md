---
name: memory
description: Persistent long-term memory. Use when learning something non-obvious, recalling prior context, verifying claims before answering, tracking sessions, or recording decisions. NOT for routine operations.
---

# Memory — Persistent Knowledge

You have a persistent brain. It survives across sessions. Use it wisely.

## The Core Loop

```
Learn -> Entity + Observation + Relation
Recall -> Search before answering
Correct -> Feedback when wrong
```

## When to WRITE

Only when something is **non-obvious and reusable**:

- **Facts** the user told you about their project, preferences, setup
- **Lessons** learned from debugging, mistakes, or exploration
- **Decisions** with rationale (why X over Y)
- **Errors** and their solutions (prevents repeating mistakes)
- **Patterns** you discover in the codebase or workflow

NOT for: routine file reads, command outputs, transient debugging state.

## When to READ

- **Before answering** factual questions about past work -> `mem({ action: "search", params: { query: "..." } })`
- **Before starting** a task that might have prior context -> `mem({ action: "search", params: { query: "..." } })`
- **When uncertain** -> `mem({ action: "search", params: { query: "...", mode: "verify" } })`

## When to FEEDBACK

- User corrects you -> `mem({ action: "feedback", params: { action: "negative" or "correct", ... } })`
- Something worked well -> `mem({ action: "feedback", params: { action: "positive", ... } })`
- Important: this strengthens or weakens memories over time (Hebbian learning)

## Session Tracking

Start sessions with `mem({ action: "session", params: { action: "start", ... } })` to track what you're working on. End with outcomes. This creates a timeline of work.

## The Anti-Pattern: Reminder of a Reminder

Do NOT:
- Check memory after every statement
- Narrate "let me check my memory..." unless it adds value
- Write trivial observations ("user opened file X")
- Re-read what you just wrote

DO:
- Search once at task start, then work
- Write at natural breakpoints (end of task, after learning something)
- Trust the decay algorithm — unimportant things fade naturally

## Memory Agents (Delegated Operations)

You have three sub-agents that handle memory operations, keeping your context clean:

| Agent | Purpose | When to Delegate |
|-------|---------|------------------|
| `memory-recall` | Retrieves relevant memories | Before answering factual questions, at task start |
| `memory-verify` | Verifies claims against stored knowledge | When uncertain, to ground responses |
| `memory-write` | Consolidates learned knowledge | At natural breakpoints, after learning something non-obvious |

### Delegation Pattern

```
User asks question -> subagent(agent="memory-recall", task="Find context about X")
                   -> Review returned context
                   -> Answer with grounding

Claim might be wrong -> subagent(agent="memory-verify", task="Verify: claim Y", inheritContext=true)
                      -> Review confidence/evidence
                      -> Adjust answer if needed

Learned something   -> subagent(agent="memory-write", task="Consolidate: [what was learned]", inheritContext=true)
                      -> Agent handles entity/observation/relation creation
```

## Workflow Summary

```
Task starts -> subagent(memory-recall) for context
            -> mem({ action: "session", params: { action: "start", name: "...", goals: [...] }})

Working...  -> Learn something? -> subagent(memory-write, inheritContext=true) to persist
            -> Hit an error?    -> mem({ action: "report", params: {...} }) (and mem({ action: "errors", params: {...} }))
            -> Make a decision? -> mem({ action: "decide", params: { action: "record", ... } })
            -> Uncertain?       -> subagent(memory-verify, inheritContext=true) to ground
            -> Memory nudge?    -> Every 10 turns, archive what you've learned

Task ends   -> mem({ action: "session", params: { action: "end", summary: "...", outcome: "success" }})
            -> mem({ action: "feedback", params: { action: "positive" or "negative", ... } })
```

## Tools Quick Reference

In the main agent, **all** memory operations go through the single `mem` dispatch:

```
mem({ action: "ACTION", params: { ... } })
```

| Action | Purpose | Common params |
|--------|---------|---------------|
| `search` | Search memory | `query`, `mode` (hybrid\|verify), `scope`, `limit` |
| `note` | Add observations | `action` (add\|batch_add\|episode_add), `entity_name`, `content`, `observation_type` |
| `session` | Session tracking | `action` (start\|end\|list\|current), `name`, `goals`, `summary`, `outcome`, `project` |
| `errors` | Search error history | `query`, `proposed_action`, `resolved_only` |
| `entity` | Create/manage entities | `action` (create\|get\|update\|delete), `name`, `entity_type` |
| `relate` | Create relations | `action` (create\|delete\|traverse\|infer\|predict), `from_entity`, `to_entity`, `relation_type` |
| `feedback` | Feedback | `action` (positive\|negative\|correct), `entity_name`, `observation_id` |
| `report` | Report errors | `error_type`, `error_message`, `context`, `project` |
| `resolve` | Resolve errors | `error_id`, `solution` |
| `decide` | Record decisions | `action` (record\|query\|list), `title`, `context`, `chosen`, `rationale`, `alternatives` |
| `contra` | Check contradictions | `action: "scan"`, `entity_name` |
| `analytics` | Graph analytics | `metric` (summary\|health\|drift\|communities\|bridges\|structural) |
| `gaps` | Gap analysis | `action: "analyze"` |
| `maintenance` | Maintenance | `action` (decay\|prune\|merge\|summarize\|stats\|pagerank\|find_duplicates\|export\|reembed) |
| `hypothesize` | Abductive inference | `action: "explain"`, `effect` |
| `trigger` | Prospective triggers | `action` (create\|list\|delete\|check), `message`, `condition_type` |
| `calibrate` | Confidence calibration | `action` (stats\|history\|resolve\|trust\|metrics) |
| `ingest` | Bulk ingestion | `action` (ingest\|parse), `items` or `text` |
| `project` | Project scoping | `action` (list\|current\|switch\|stats\|rename\|merge), `name`, `to` |
| `snapshot` | Snapshot/restore | `action` (snapshot\|restore) |
| `sync` | Export/import | `action` (export\|import\|diff\|status), `dir`, `scope` |
| `audit` | Audit log | `action` (append\|verify\|tail), `event_action`, `payload` |
| `buffer` | Working memory | `action` (write\|read\|clear), `content`, `tag`, `ttl_seconds` |
| `judge` | LLM-judge conflicts | `action` (judge_pair\|scan_entity), `observation_a`, `observation_b` |
| `forget` | GDPR erasure | `entity_name`, `confirm: true` |

Subagents (`memory-recall`, `memory-verify`, `memory-write`, `memory-admin`) still use the individual `mem_*` tools declared in their frontmatter.

## Entity Types

- `concept` — abstract ideas, patterns, principles
- `technology` — tools, frameworks, languages
- `person` — users, collaborators, authors
- `project` — codebases, initiatives
- `pattern` — recurring solutions, anti-patterns
- `config` — settings, environment details

## Observation Types

- `fact` — verified information (decays in 30d)
- `decision` — choices with rationale (protected, never decays)
- `lesson` — learned from experience (protected)
- `preference` — user preferences (decays in 30d)
- `error` — things that went wrong (decays in 14d)
- `solution` — how to fix things (decays in 14d)
- `context` — situational info (decays in 7d)
- `tool_usage` — how tools are used (decays in 7d)
