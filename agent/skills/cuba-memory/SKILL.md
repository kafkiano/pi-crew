---
name: cuba-memory
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

- **Before answering** factual questions about past work -> `mem_search`
- **Before starting** a task that might have prior context -> `mem_search`
- **When uncertain** -> `mem_search` with `mode: "verify"`

## When to FEEDBACK

- User corrects you -> `mem_feedback` (negative or correct)
- Something worked well -> `mem_feedback` (positive)
- Important: this strengthens or weakens memories over time (Hebbian learning)

## Session Tracking

Start sessions with `mem_session` to track what you're working on. End with outcomes. This creates a timeline of work.

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
            -> mem_session start (track session)

Working...  -> Learn something? -> subagent(memory-write, inheritContext=true) to persist
            -> Hit an error?    -> mem_report (and check mem_errors)
            -> Make a decision? -> mem_decide
            -> Uncertain?       -> subagent(memory-verify, inheritContext=true) to ground
            -> Memory nudge?    -> Every 10 turns, archive what you've learned

Task ends   -> mem_session end (summarize outcomes)
            -> mem_feedback (feedback on what worked/didn't)
```

## Tools Quick Reference

| Tool | Purpose | When |
|------|---------|------|
| `mem_entity` | Create/manage entities | New concept, tech, person, pattern |
| `mem_note` | Add observations | Facts, lessons, preferences |
| `mem_relate` | Create relations | Connect entities (uses, causes, etc.) |
| `mem_search` | Search memory | Before answering, grounding |
| `mem_feedback` | Feedback | Correct, reinforce, weaken |
| `mem_report` | Report errors | When something breaks |
| `mem_resolve` | Resolve errors | When you fix something |
| `mem_errors` | Search errors | Before trying similar approaches |
| `mem_session` | Session tracking | Start/end of work sessions |
| `mem_decide` | Record decisions | Architecture/design choices |
| `mem_contra` | Check contradictions | After writing new observations |

### Advanced Tools

| Tool | Purpose |
|------|---------|
| `mem_analytics` | Knowledge graph analytics and health check |
| `mem_gaps` | Gap analysis — find underconnected knowledge |
| `mem_maintenance` | Memory maintenance — decay, pruning, merge, reembed |
| `mem_hypothesize` | Abductive inference from observations |
| `mem_trigger` | Set prospective memory triggers |
| `mem_ingest` | Bulk knowledge ingestion |
| `mem_forget` | GDPR erasure of entities |
| `mem_buffer` | Working memory buffer |
| `mem_calibrate` | Confidence calibration and trust scores |
| `mem_project` | Project scoping and isolation |
| `mem_snapshot` | Compaction survival (snapshot/restore) |
| `mem_sync` | Git-friendly export/import |
| `mem_audit` | Tamper-evident audit log |
| `mem_judge` | LLM-judge for ambiguous conflicts |

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
