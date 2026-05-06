---
name: cuba-memory
description: Persistent long-term memory via cuba-memorys MCP. Use when learning something non-obvious, recalling prior context, verifying claims before answering, tracking sessions, or recording decisions. NOT for routine operations.
---

# Cuba Memory — Persistent Knowledge

You have a persistent brain. It survives across sessions. Use it wisely.

## The Core Loop

```
Learn → Entity + Observation + Relation
Recall → Search before answering
Correct → Feedback when wrong
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

- **Before answering** factual questions about past work → `cuba_faro`
- **Before starting** a task that might have prior context → `cuba_faro`
- **When uncertain** → `cuba_faro` with `mode: "verify"`

## When to FEEDBACK

- User corrects you → `cuba_eco` (negative or correct)
- Something worked well → `cuba_eco` (positive)
- Important: this strengthens or weakens memories over time (Hebbian learning)

## Session Tracking

Start sessions with `cuba_jornada` to track what you're working on. End with outcomes. This creates a timeline of work.

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
User asks question → subagent(agent="memory-recall", task="Find context about X")
                   → Review returned context
                   → Answer with grounding

Claim might be wrong → subagent(agent="memory-verify", task="Verify: claim Y", inheritContext=true)
                      → Review confidence/evidence
                      → Adjust answer if needed

Learned something   → subagent(agent="memory-write", task="Consolidate: [what was learned]", inheritContext=true)
                      → Agent handles entity/observation/relation creation
```

## Workflow Summary

```
Task starts → subagent(memory-recall) for context
            → cuba_jornada start (track session)
            
Working...  → Learn something? → subagent(memory-write, inheritContext=true) to persist
            → Hit an error?    → cuba_alarma (and check cuba_expediente)
            → Make a decision? → cuba_decreto
            → Uncertain?       → subagent(memory-verify, inheritContext=true) to ground
            → Memory nudge?    → Every 10 turns, archive what you've learned

Task ends   → cuba_jornada end (summarize outcomes)
            → cuba_eco (feedback on what worked/didn't)
```

## Tools Quick Reference

| Tool | Purpose | When |
|------|---------|------|
| `cuba_alma` | Create/manage entities | New concept, tech, person, pattern |
| `cuba_cronica` | Add observations | Facts, lessons, preferences |
| `cuba_puente` | Create relations | Connect entities (uses, causes, etc.) |
| `cuba_faro` | Search memory | Before answering, grounding |
| `cuba_eco` | Feedback | Correct, reinforce, weaken |
| `cuba_alarma` | Report errors | When something breaks |
| `cuba_remedio` | Resolve errors | When you fix something |
| `cuba_expediente` | Search errors | Before trying similar approaches |
| `cuba_jornada` | Session tracking | Start/end of work sessions |
| `cuba_decreto` | Record decisions | Architecture/design choices |
| `cuba_vigia` | Health check | Periodic graph analysis |
| `cuba_reflexion` | Gap analysis | Find underconnected knowledge |

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
