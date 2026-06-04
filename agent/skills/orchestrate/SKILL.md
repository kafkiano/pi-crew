---
name: orchestrate
description: Orchestrate subagents for larger implementations or full-scale prototyping. Use to implement major changes, turn complex ideas into concrete prototypes, or improve a project through several consistent iterations. 
---

You orchestrate four agent types:

- **architect** — Analyzes the codebase, researches externally, drafts ACTION_PLAN.md. Read-only, evidence-backed, no implementation. Use whenever you want a second architectural opinion or need deep research before planning.
- **coder** — Implements the plan. Strong senior programmer who reads before writes, uses existing primitives, rejects unnecessary abstraction.
- **tester** — Runs tests, type checks, linters. Reports results without modifying code.
- **memory-recall / memory-write** — Restore prior context at session start; archive learnings at session end.

## The Loop

1. **You** brief the architect with requirements, constraints, and what you already know about the codebase
2. **Architect** explores the codebase, researches externally, and drafts ACTION_PLAN.md
3. **You** review the plan — adversarial check. Does it respect existing invariants? Are the trade-offs right? Send back with specific feedback if needed
4. **You** create a branch: `git checkout -b feat/description`
5. **Coder** implements the ACTION_PLAN.md
6. **Tester** runs tests on the branch
7. **You** review the result — pass or send back to coder with specific feedback
8. **You** Will eventually iterate steps 1-7 until the result meets your quality standards
9. **You** merge the branch

## The Architect

The architect is your second pair of eyes. It uses a different model (`mimo-v2.5-pro`) with different training — it will catch assumptions you've normalized. It can research libraries, patterns, and approaches externally via `web_search`, `fetch_content`, and `code_search`.

**When to use it:**
- The codebase is large and you want a fresh perspective on its architecture
- You need to research external libraries or patterns before planning
- You want an ACTION_PLAN.md draft to review rather than writing from scratch
- You're unsure about a trade-off and want a second architectural opinion

**How to brief it:**
- Describe the problem and goal
- List constraints you already know (existing invariants, dependencies that can't change)
- Point to relevant files or modules
- Ask specific questions if you have them

The architect produces evidence-backed analysis with citations from the codebase or external sources. You verify, not rubber-stamp.

## Context for Subagents

When delegating, you can include:
- The relevant section of ACTION_PLAN.md (not the whole file)
- File paths the agent needs to read first
- Any conventions or patterns specific to this codebase (through `inheritContext` param)

Keep task descriptions focused. One step per delegation. The coder reads ACTION_PLAN.md at start — you don't need to repeat the whole plan.

## Iteration

If the coder's output doesn't meet your standards:
- Be specific about what's wrong (file, line, function)
- Reference the plan section that was violated
- Do NOT rewrite the code yourself — send it back

The coder improves until the result is elegantly aligned with the plan.

If the architect's output doesn't meet your standards:
- Be specific about what's missing or wrong in the analysis
- Point to codebase evidence the architect missed
- Ask for deeper research on a specific aspect

## Quick Delegation

Not every task needs the full orchestrate loop. You can delegate directly:
- `subagent({ agent: "architect", task: "..." })` — for a single architectural question
- `subagent({ agent: "coder", task: "..." })` — for a single implementation step
- `subagent({ agent: "tester", task: "..." })` — for a quick test run

The full loop is for multi-step features. Quick delegation is for isolated questions.
