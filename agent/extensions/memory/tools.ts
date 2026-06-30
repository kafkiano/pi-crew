/**
 * Memory tool definitions — clean-named wrappers for cuba-memorys MCP tools.
 *
 * Each tool maps to an original MCP tool name on the cuba-memorys server.
 * The schemas are copied from the MCP server's tool metadata.
 */

import { Type, type Static } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { McpStdioClient, McpToolResult } from "./mcp-client.js";

// ── Shared helpers ──────────────────────────────────────────────────

function makeTool(
  name: string,
  label: string,
  description: string,
  promptSnippet: string,
  promptGuidelines: string[],
  mcpName: string,
  schema: Parameters<typeof Type.Object>[0],
) {
  return { name, label, description, promptSnippet, promptGuidelines, mcpName, schema };
}

function createTool(
  def: ReturnType<typeof makeTool>,
  client: McpStdioClient,
) {
  return defineTool({
    name: def.name,
    label: def.label,
    description: def.description,
    promptSnippet: def.promptSnippet,
    promptGuidelines: def.promptGuidelines,
    parameters: Type.Object(def.schema),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx): Promise<McpToolResult> {
      try {
        return await client.callTool(def.mcpName, params as Record<string, unknown>);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Memory tool error (${def.name}): ${message}` }],
          isError: true,
        };
      }
    },
  });
}

// ── Tool definitions ────────────────────────────────────────────────

export function getMemoryTools(client: McpStdioClient) {
  const defs = [
    makeTool(
      "mem_search",
      "Memory Search",
      "Search the persistent knowledge graph for relevant memories. Returns entities, observations, relations, and errors matching the query. Use BEFORE answering questions to ground responses in known context. Supports hybrid text+vector search, temporal filtering, and verification mode.",
      "Search persistent memory — entities, facts, relations, errors. Use before answering to ground in known context.",
      [
        "Use mem_search before answering non-trivial questions to check if relevant context exists in memory.",
        "Use mode='verify' to check if a specific claim is grounded in stored evidence.",
        "Use temporal filters (after/before) to narrow results to a time period.",
        "Use scope='entities' or scope='observations' to target specific result types.",
      ],
      "cuba_faro",
      {
        query: Type.String({ description: "Search text" }),
        mode: Type.Optional(Type.Union([Type.Literal("hybrid"), Type.Literal("verify")], {
          description: "Search mode (default: hybrid). 'verify' checks if claim is grounded.",
        })),
        scope: Type.Optional(Type.Union([
          Type.Literal("all"), Type.Literal("entities"),
          Type.Literal("observations"), Type.Literal("errors"),
        ], { description: "Where to search (default: all)" })),
        limit: Type.Optional(Type.Number({ description: "Max results (default 10, max 50)" })),
        max_tokens: Type.Optional(Type.Number({ description: "Token budget for results (default 5000)" })),
        format: Type.Optional(Type.Union([Type.Literal("verbose"), Type.Literal("compact")], {
          description: "Response format: verbose (default) or compact (~35% fewer tokens)",
        })),
        after: Type.Optional(Type.String({ description: "ISO8601 datetime — return results created after this time" })),
        before: Type.Optional(Type.String({ description: "ISO8601 datetime — return results created before this time" })),
        tags: Type.Optional(Type.String({ description: "Filter observations by tag keyword (exact match)" })),
        diversify: Type.Optional(Type.Boolean({ description: "Post-RRF MMR pass penalizing near-duplicates. Default false." })),
        enable_bm25: Type.Optional(Type.Boolean({ description: "Enable BM25 as third RRF signal. Default true." })),
        rerank: Type.Optional(Type.Boolean({ description: "Cross-encoder rerank top-50 → top-K. Default false." })),
        abstain_ood: Type.Optional(Type.Boolean({ description: "Abstain when query is out-of-distribution. Default false." })),
        mmr_lambda: Type.Optional(Type.Number({ description: "MMR balance: 1.0 pure relevance, 0.0 pure diversity. Default 0.7." })),
        ood_threshold: Type.Optional(Type.Number({ description: "Mahalanobis distance threshold for abstention. Default 5.0." })),
      },
    ),

    makeTool(
      "mem_note",
      "Memory Note",
      "Attach observations (facts, decisions, lessons, preferences) to entities in the knowledge graph. Also supports episodic memories (events with actors/artifacts) and timeline views. Auto-creates entities if not found. Dedup gate blocks near-duplicates.",
      "Attach facts, lessons, decisions, or episodes to memory entities. Auto-creates entities.",
      [
        "Use mem_note to persist learned facts, user preferences, or lessons from debugging.",
        "Use observation_type to categorize: fact, decision, lesson, preference, context, error, solution.",
        "Use episode_add for temporal events with actors and artifacts.",
        "Use batch_add to write multiple observations efficiently (max 100).",
      ],
      "cuba_cronica",
      {
        action: Type.Union([
          Type.Literal("add"), Type.Literal("delete"), Type.Literal("list"),
          Type.Literal("batch_add"), Type.Literal("episode_add"),
          Type.Literal("episode_list"), Type.Literal("timeline"),
        ], { description: "Operation to perform" }),
        entity_name: Type.Optional(Type.String({ description: "Entity to attach observation/episode to" })),
        content: Type.Optional(Type.String({ description: "Observation or episode text" })),
        observation_type: Type.Optional(Type.Union([
          Type.Literal("fact"), Type.Literal("decision"), Type.Literal("lesson"),
          Type.Literal("preference"), Type.Literal("context"),
          Type.Literal("tool_usage"), Type.Literal("error"), Type.Literal("solution"),
        ], { description: "Type of observation" })),
        source: Type.Optional(Type.Union([
          Type.Literal("agent"), Type.Literal("user"),
          Type.Literal("error_detection"), Type.Literal("consolidation"), Type.Literal("inference"),
        ], { description: "Who/what created this observation" })),
        observation_id: Type.Optional(Type.String({ description: "Observation UUID (for delete action)" })),
        observations: Type.Optional(Type.Array(Type.Object({}), {
          description: "Array of {entity_name, content, observation_type?, source?} objects (for batch_add, max 100)",
        })),
        actors: Type.Optional(Type.Array(Type.String(), {
          description: "People/agents involved in episode (for episode_add)",
        })),
        artifacts: Type.Optional(Type.Array(Type.String(), {
          description: "Files/resources affected in episode (for episode_add)",
        })),
      },
    ),

    makeTool(
      "mem_entity",
      "Memory Entity",
      "CRUD operations on knowledge graph entities (concepts, projects, technologies, patterns, people, config). Auto-boosts neighbor importance on access. For transient info use mem_note instead.",
      "Create, read, update, or delete knowledge graph entities (concepts, projects, technologies, patterns).",
      [
        "Use mem_entity with action='get' to check if an entity exists before adding observations.",
        "Use action='create' for new entities. Choose entity_type that best describes: concept, project, technology, person, pattern, config.",
        "Use action='update' to rename entities.",
      ],
      "cuba_alma",
      {
        action: Type.Union([
          Type.Literal("create"), Type.Literal("update"),
          Type.Literal("delete"), Type.Literal("get"),
        ], { description: "Operation to perform" }),
        name: Type.String({ description: "Entity name (unique identifier)" }),
        entity_type: Type.Optional(Type.String({
          description: "Type: concept, project, technology, person, pattern, config",
        })),
        new_name: Type.Optional(Type.String({ description: "New name for update action" })),
      },
    ),

    makeTool(
      "mem_relate",
      "Memory Relate",
      "Create, delete, traverse, and infer relations between entities. Supports relation types: uses, causes, implements, depends_on, related_to. 'traverse' explores connections, 'infer' does transitive reasoning, 'predict' suggests missing links via Adamic-Adar.",
      "Create or explore relations between memory entities (uses, causes, implements, depends_on, related_to).",
      [
        "Use mem_relate to connect entities with meaningful relationships.",
        "Use action='traverse' to explore the graph from a starting entity.",
        "Use action='predict' to discover likely missing relations via Adamic-Adar.",
        "Use action='infer' for transitive reasoning (A→B→C).",
      ],
      "cuba_puente",
      {
        action: Type.Union([
          Type.Literal("create"), Type.Literal("delete"),
          Type.Literal("traverse"), Type.Literal("infer"), Type.Literal("predict"),
        ], { description: "Operation to perform" }),
        from_entity: Type.Optional(Type.String({ description: "Source entity name" })),
        to_entity: Type.Optional(Type.String({ description: "Target entity name" })),
        relation_type: Type.Optional(Type.String({
          description: "Relation: uses, causes, implements, depends_on, related_to",
        })),
        bidirectional: Type.Optional(Type.Boolean({ description: "If true, relation goes both ways" })),
        start_entity: Type.Optional(Type.String({ description: "Start point for traverse/infer" })),
        entity_name: Type.Optional(Type.String({
          description: "Entity name for predict action (Adamic-Adar link prediction)",
        })),
        max_depth: Type.Optional(Type.Number({ description: "Max hops for traverse/infer (default 3, max 5)" })),
      },
    ),

    makeTool(
      "mem_feedback",
      "Memory Feedback",
      "RLHF feedback on memory quality. Positive boosts importance (Oja's rule), negative decreases, correct updates content. Use to reinforce accurate memories and fix inaccurate ones.",
      "Reinforce or correct stored memories — positive boost, negative decay, or content correction.",
      [
        "Use mem_feedback to improve memory quality over time.",
        "Use action='positive' when a stored fact proved accurate and useful.",
        "Use action='negative' when a stored fact was misleading or wrong.",
        "Use action='correct' to fix the content of an existing observation.",
      ],
      "cuba_eco",
      {
        action: Type.Union([
          Type.Literal("positive"), Type.Literal("negative"), Type.Literal("correct"),
        ], { description: "Feedback type" }),
        entity_name: Type.Optional(Type.String({ description: "Target entity" })),
        observation_id: Type.Optional(Type.String({ description: "Target observation UUID" })),
        correction: Type.Optional(Type.String({ description: "New content (for correct action)" })),
      },
    ),

    makeTool(
      "mem_session",
      "Memory Session",
      "Track working sessions with goals and outcomes. Bind sessions to projects for scoped memory operations. Use to maintain continuity across working sessions.",
      "Track working sessions — start, end, list, and bind to projects for scoped memory.",
      [
        "Use mem_session to maintain working context across sessions.",
        "Use action='start' at the beginning of a focused work session with clear goals.",
        "Use action='end' with a summary when the session concludes.",
        "Use the 'project' parameter to scope the session to a specific project.",
      ],
      "cuba_jornada",
      {
        action: Type.Union([
          Type.Literal("start"), Type.Literal("end"),
          Type.Literal("list"), Type.Literal("current"),
        ], { description: "Session action" }),
        name: Type.Optional(Type.String({ description: "Session name (for start)" })),
        goals: Type.Optional(Type.Array(Type.String(), { description: "Session goals (for start)" })),
        summary: Type.Optional(Type.String({ description: "What was accomplished (for end)" })),
        outcome: Type.Optional(Type.Union([
          Type.Literal("success"), Type.Literal("partial"),
          Type.Literal("failed"), Type.Literal("abandoned"),
        ], { description: "Session outcome (for end)" })),
        project: Type.Optional(Type.String({
          description: "Project name to bind this session to (created on first use)",
        })),
      },
    ),

    makeTool(
      "mem_decide",
      "Memory Decide",
      "Record and query architecture/design decisions with rationale and alternatives considered. Use to maintain decision history and avoid revisiting settled questions.",
      "Record or query architecture/design decisions with rationale and alternatives.",
      [
        "Use mem_decide to record significant architectural choices with their rationale.",
        "Use action='query' to check if a similar decision was already made.",
        "Always include the 'alternatives' considered to document the decision space.",
      ],
      "cuba_decreto",
      {
        action: Type.Union([
          Type.Literal("record"), Type.Literal("query"), Type.Literal("list"),
        ], { description: "Decision action" }),
        title: Type.Optional(Type.String({ description: "Decision title (for record)" })),
        context: Type.Optional(Type.String({ description: "Why this decision was needed" })),
        chosen: Type.Optional(Type.String({ description: "Option chosen" })),
        rationale: Type.Optional(Type.String({ description: "Why this option was chosen" })),
        alternatives: Type.Optional(Type.Array(Type.String(), { description: "Options considered" })),
        query: Type.Optional(Type.String({ description: "Search text (for query action)" })),
      },
    ),

    makeTool(
      "mem_errors",
      "Memory Errors",
      "Search past errors and solutions. Use 'proposed_action' as anti-repetition guard: warns if a similar approach previously failed. Use to avoid repeating past mistakes.",
      "Search error history and solutions. Anti-repetition guard warns if a similar approach failed before.",
      [
        "Use mem_errors before debugging to check if the same error was encountered and solved before.",
        "Use proposed_action to check if your planned approach has failed in the past.",
        "Use resolved_only=true to only see errors that have known solutions.",
      ],
      "cuba_expediente",
      {
        query: Type.String({ description: "Search text for errors" }),
        proposed_action: Type.Optional(Type.String({
          description: "Anti-repetition: describe what you plan to do. Returns warning if similar approach failed before.",
        })),
        resolved_only: Type.Optional(Type.Boolean({ description: "Only return errors with solutions" })),
        project: Type.Optional(Type.String({ description: "Filter by project" })),
      },
    ),

    makeTool(
      "mem_report",
      "Memory Report",
      "Report a new error to the knowledge graph. Auto-detects patterns (≥3 similar = warning). Errors with similar contexts get boosted for easier retrieval (Hebbian learning).",
      "Report a new error to persistent memory. Auto-detects patterns and cross-references similar errors.",
      [
        "Use mem_report immediately when encountering an error to build the error knowledge base.",
        "Include error_type for categorization (TypeError, ConnectionError, etc.).",
        "Include context (file, function, line) for better pattern detection.",
      ],
      "cuba_alarma",
      {
        error_type: Type.String({ description: "Error category: TypeError, ConnectionError, etc." }),
        error_message: Type.String({ description: "Full error message" }),
        context: Type.Optional(Type.Object({
          file: Type.Optional(Type.String()),
          function: Type.Optional(Type.String()),
          line: Type.Optional(Type.Union([Type.Number(), Type.String()])),
          stack_trace: Type.Optional(Type.String()),
        }, { description: "Error context: file, function, stack_trace, line" })),
        project: Type.Optional(Type.String({ description: "Project name (default: 'default')" })),
      },
    ),

    makeTool(
      "mem_resolve",
      "Memory Resolve",
      "Mark a previously reported error as resolved with its solution. Cross-references similar unresolved errors to help them get solved too.",
      "Mark an error as resolved with its solution. Cross-references similar unresolved errors.",
      [
        "Use mem_resolve after successfully fixing an error that was reported with mem_report.",
        "Provide the error_id from mem_report and a clear description of the solution.",
      ],
      "cuba_remedio",
      {
        error_id: Type.String({ description: "UUID of the error to solve" }),
        solution: Type.String({ description: "Solution that fixed the error" }),
      },
    ),

    makeTool(
      "mem_contra",
      "Memory Contradiction",
      "Detect semantic contradictions between observations of the same entity. Uses embedding cosine distance + negation heuristics. Read-only — does not modify the knowledge graph.",
      "Detect contradictions between stored observations about the same entity.",
      [
        "Use mem_contra after writing new observations to check for conflicts with existing knowledge.",
        "Omit entity_name to scan the top entities by observation count.",
      ],
      "cuba_contradiccion",
      {
        action: Type.Literal("scan", { description: "Contradiction detection action" }),
        entity_name: Type.Optional(Type.String({ description: "Entity to scan (omit for top entities)" })),
      },
    ),

    // ── Advanced tools (less frequent usage) ───────────────────────────

    makeTool(
      "mem_analytics",
      "Memory Analytics",
      "Knowledge graph analytics: summary (counts + token estimate), health (staleness, entropy, DB size), drift (chi-squared on errors), communities (Leiden), bridges (betweenness centrality), structural (harmonic + closeness centrality + k-core).",
      "Knowledge graph analytics — summary, health, drift, communities, bridges, structural analysis.",
      [],
      "cuba_vigia",
      {
        metric: Type.Union([
          Type.Literal("summary"), Type.Literal("health"), Type.Literal("drift"),
          Type.Literal("communities"), Type.Literal("bridges"), Type.Literal("structural"),
        ], { description: "Metric to compute" }),
      },
    ),

    makeTool(
      "mem_maintenance",
      "Memory Maintenance",
      "Memory maintenance: decay (stratified exponential by type), prune (remove low-importance), merge (deduplicate), summarize (compress observations), pagerank (personalized importance), find_duplicates, export, stats, reembed.",
      "Memory maintenance — decay, prune, merge, summarize, pagerank, dedup, export, reembed.",
      [],
      "cuba_zafra",
      {
        action: Type.Union([
          Type.Literal("decay"), Type.Literal("prune"), Type.Literal("merge"),
          Type.Literal("summarize"), Type.Literal("stats"), Type.Literal("pagerank"),
          Type.Literal("find_duplicates"), Type.Literal("export"),
          Type.Literal("reembed"), Type.Literal("decay_episodes"),
        ], { description: "Consolidation action" }),
        threshold: Type.Optional(Type.Number({ description: "Importance threshold for prune (default 0.1)" })),
        halflife_days: Type.Optional(Type.Number({ description: "Global halflife override for decay" })),
        similarity_threshold: Type.Optional(Type.Number({ description: "Similarity threshold for merge (default 0.8)" })),
        entity_name: Type.Optional(Type.String({ description: "Entity to summarize (for summarize action)" })),
        compressed_summary: Type.Optional(Type.String({ description: "Compressed text replacing observations (for summarize)" })),
        batch_size: Type.Optional(Type.Number({ description: "Max observations to re-encode in reembed (default 500)" })),
        beta: Type.Optional(Type.Number({ description: "Power-law β exponent for decay_episodes (default 0.5)" })),
        c: Type.Optional(Type.Number({ description: "Power-law c parameter for decay_episodes (default 0.1)" })),
      },
    ),

    makeTool(
      "mem_forget",
      "Memory Forget",
      "GDPR Right to Erasure: cascading hard-delete of an entity and ALL references across observations, relations, errors, and sessions. IRREVERSIBLE. Requires confirm=true.",
      "Hard-delete an entity and all references. IRREVERSIBLE. Requires confirm=true.",
      [],
      "cuba_forget",
      {
        entity_name: Type.String({ description: "Entity name to erase completely" }),
        confirm: Type.Boolean({ description: "Must be true to proceed (safety gate)" }),
      },
    ),

    makeTool(
      "mem_gaps",
      "Memory Gaps",
      "Analyze knowledge graph for structural gaps: isolated entities, underconnected hubs, type silos, observation gaps (missing decisions/lessons), and statistical density anomalies. Read-only introspection.",
      "Analyze knowledge graph for structural gaps and missing connections.",
      [],
      "cuba_reflexion",
      {
        action: Type.Literal("analyze", { description: "Gap analysis action (only 'analyze' supported)" }),
      },
    ),

    makeTool(
      "mem_hypothesize",
      "Memory Hypothesize",
      "Abductive inference: given an observed effect, find plausible causes by traversing causal relations backwards. Returns hypotheses ranked by plausibility (path_strength × importance). Read-only.",
      "Find plausible causes for an observed effect via abductive inference.",
      [],
      "cuba_hipotesis",
      {
        action: Type.Literal("explain", { description: "Inference action" }),
        effect: Type.String({ description: "Entity name representing the observed effect" }),
        limit: Type.Optional(Type.Number({ description: "Max hypotheses to return (default 10, max 50)" })),
        max_depth: Type.Optional(Type.Number({ description: "Max causal chain hops (default 3, max 5)" })),
      },
    ),

    makeTool(
      "mem_trigger",
      "Memory Trigger",
      "Prospective memory: set triggers that fire when entities are accessed, sessions start, or errors match. 'Remember to remind me about X when Y happens.'",
      "Set prospective memory triggers — remind me about X when Y happens.",
      [],
      "cuba_centinela",
      {
        action: Type.Union([
          Type.Literal("create"), Type.Literal("list"),
          Type.Literal("delete"), Type.Literal("check"),
        ], { description: "Trigger action" }),
        message: Type.Optional(Type.String({ description: "Reminder message to surface when triggered" })),
        condition_type: Type.Optional(Type.Union([
          Type.Literal("on_access"), Type.Literal("on_session_start"), Type.Literal("on_error_match"),
        ], { description: "When to fire" })),
        entity_pattern: Type.Optional(Type.String({ description: "Entity name or pattern to match" })),
        max_fires: Type.Optional(Type.Number({ description: "Max times to fire (default 1, -1 for unlimited)" })),
        expires_at: Type.Optional(Type.String({ description: "ISO8601 expiration datetime" })),
        trigger_id: Type.Optional(Type.String({ description: "Trigger UUID (for delete)" })),
      },
    ),

    makeTool(
      "mem_calibrate",
      "Memory Calibrate",
      "Bayesian confidence calibration: track verify predictions, mark outcomes, compute P(correct|level). 'trust' returns per-source credibility. 'metrics' returns Brier score + Expected Calibration Error.",
      "Confidence calibration — track verify accuracy, compute trust scores.",
      [],
      "cuba_calibrar",
      {
        action: Type.Union([
          Type.Literal("stats"), Type.Literal("history"),
          Type.Literal("resolve"), Type.Literal("trust"), Type.Literal("metrics"),
        ], { description: "Calibration action" }),
        verify_id: Type.Optional(Type.String({ description: "Verify log UUID (for resolve)" })),
        outcome: Type.Optional(Type.Union([Type.Literal("correct"), Type.Literal("incorrect")], {
          description: "Whether the verify prediction was right (for resolve)",
        })),
        limit: Type.Optional(Type.Number({ description: "Max results for history (default 20)" })),
      },
    ),

    makeTool(
      "mem_ingest",
      "Memory Ingest",
      "Bulk knowledge ingestion: 'ingest' accepts structured items, 'parse' splits long text by paragraphs and auto-classifies each. Uses same dedup/embedding pipeline as mem_note.",
      "Bulk ingest observations or parse long text into observations.",
      [],
      "cuba_ingesta",
      {
        action: Type.Union([Type.Literal("ingest"), Type.Literal("parse")], {
          description: "Ingestion mode. 'ingest' for structured items, 'parse' for raw text splitting.",
        }),
        items: Type.Optional(Type.Array(Type.Object({}), {
          description: "Array of {entity_name, content, observation_type?} objects (for ingest, max 200)",
        })),
        text: Type.Optional(Type.String({ description: "Long text to split into observations (for parse)" })),
        entity_name: Type.Optional(Type.String({
          description: "Entity to attach parsed observations to (for parse action)",
        })),
      },
    ),

    makeTool(
      "mem_project",
      "Memory Project",
      "Project scoping: isolate memories per project so multiple projects sharing one DB don't bleed into each other. Active project is bound via mem_session (start --project NAME).",
      "Manage project scoping — list, switch, stats, rename, merge projects.",
      [],
      "cuba_proyecto",
      {
        action: Type.Union([
          Type.Literal("list"), Type.Literal("current"), Type.Literal("switch"),
          Type.Literal("stats"), Type.Literal("rename"), Type.Literal("merge"),
        ], { description: "Project action" }),
        name: Type.Optional(Type.String({ description: "Project name (for switch/stats/rename source)" })),
        to: Type.Optional(Type.String({ description: "Destination name (for rename/merge)" })),
      },
    ),

    makeTool(
      "mem_snapshot",
      "Memory Snapshot",
      "Compaction-survival protocol. 'snapshot' persists a dense markdown summary of the active session (recent observations, decisions, unresolved errors, goals). 'restore' retrieves the latest snapshot.",
      "Snapshot/restore session state before/after compaction.",
      [],
      "cuba_pre_compact",
      {
        action: Type.Union([Type.Literal("snapshot"), Type.Literal("restore")], {
          description: "snapshot persists a session summary; restore returns the latest",
        }),
      },
    ),

    makeTool(
      "mem_sync",
      "Memory Sync",
      "Git-friendly export/import of the knowledge graph. 'export' writes one JSON file per entity plus episodes/decisions/errors/relations. 'import' merges files back idempotently. 'diff' and 'status' for comparison.",
      "Git-friendly export/import of the knowledge graph.",
      [],
      "cuba_sync",
      {
        action: Type.Union([
          Type.Literal("export"), Type.Literal("import"),
          Type.Literal("diff"), Type.Literal("status"),
        ], { description: "Sync mode" }),
        dir: Type.Optional(Type.String({ description: "Directory override (default ./.cuba-memorys/)" })),
        scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("all")], {
          description: "Export scope: only the active project (default) or all data",
        })),
        conflict: Type.Optional(Type.Union([
          Type.Literal("merge"), Type.Literal("skip"), Type.Literal("overwrite"),
        ], { description: "Import conflict policy (default merge)" })),
        with_embeddings: Type.Optional(Type.Boolean({
          description: "Include the embeddings.bin.zst blob on export (default false)",
        })),
      },
    ),

    makeTool(
      "mem_audit",
      "Memory Audit",
      "Tamper-evident audit log (CFR-21 Part 11 inspired). Append-only with SHA-256 hash chain. UPDATE/DELETE blocked at PostgreSQL trigger level. Use 'verify' to walk the chain and detect tampering.",
      "Tamper-evident audit log — append, verify chain, tail recent entries.",
      [],
      "cuba_archivo",
      {
        action: Type.Union([
          Type.Literal("append"), Type.Literal("verify"), Type.Literal("tail"),
        ], { description: "Audit operation" }),
        event_action: Type.Optional(Type.String({ description: "Event type (for append)" })),
        payload: Type.Optional(Type.Object({}), { description: "Arbitrary JSON payload (for append)" }),
        limit: Type.Optional(Type.Number({ description: "Limit for verify/tail (default 10000 / 20)" })),
      },
    ),

    makeTool(
      "mem_buffer",
      "Memory Buffer",
      "Working memory buffer (Baddeley 1992): a TTL-bounded scratchpad orthogonal to episodic and semantic memory. Use for inter-step plan state, tentative observations, cross-tool-call reminders inside one session. Auto-expires by ttl_seconds.",
      "Working memory buffer — TTL-bounded scratchpad for session-local state.",
      [],
      "cuba_pizarra",
      {
        action: Type.Union([
          Type.Literal("write"), Type.Literal("read"), Type.Literal("clear"),
        ], { description: "Working-memory operation" }),
        content: Type.Optional(Type.String({ description: "Content to store (for write)" })),
        tag: Type.Optional(Type.String({ description: "Optional tag for filtering on read/clear" })),
        ttl_seconds: Type.Optional(Type.Number({ description: "Time-to-live in seconds (default 3600)" })),
      },
    ),

    makeTool(
      "mem_judge",
      "Memory Judge",
      "LLM-judge for semantically-conflicting observations. When cosine similarity sits in the ambiguous band (0.6-0.8), escalates a pair to an LLM to decide if they truly conflict.",
      "LLM-judge for ambiguous observation conflicts.",
      [],
      "cuba_juez",
      {
        action: Type.Union([Type.Literal("judge_pair"), Type.Literal("scan_entity")], {
          description: "judge_pair = decide on two obs; scan_entity = pull ambiguous pairs and judge each",
        }),
        observation_a: Type.Optional(Type.String({ description: "UUID of first observation (for judge_pair)" })),
        observation_b: Type.Optional(Type.String({ description: "UUID of second observation (for judge_pair)" })),
        entity_name: Type.Optional(Type.String({ description: "Entity to scan (for scan_entity)" })),
        max_pairs: Type.Optional(Type.Number({ description: "Max pairs to escalate per call (default 5)" })),
      },
    ),
  ];

  return defs.map((def) => createTool(def, client));
}

// ── Dispatch tool ──────────────────────────────────────────────────

const ACTION_MAP: Record<string, string> = {
  // Core operations (also available as standalone mem_* tools for subagents)
  search: "cuba_faro",
  note: "cuba_cronica",
  session: "cuba_jornada",
  errors: "cuba_expediente",
  // Everything else
  entity: "cuba_alma",
  relate: "cuba_puente",
  feedback: "cuba_eco",
  decide: "cuba_decreto",
  report: "cuba_alarma",
  resolve: "cuba_remedio",
  contra: "cuba_contradiccion",
  analytics: "cuba_vigia",
  maintenance: "cuba_zafra",
  forget: "cuba_forget",
  gaps: "cuba_reflexion",
  hypothesize: "cuba_hipotesis",
  trigger: "cuba_centinela",
  calibrate: "cuba_calibrar",
  ingest: "cuba_ingesta",
  project: "cuba_proyecto",
  snapshot: "cuba_pre_compact",
  sync: "cuba_sync",
  audit: "cuba_archivo",
  buffer: "cuba_pizarra",
  judge: "cuba_juez",
};

export function getMemDispatchTool(client: McpStdioClient) {
  return defineTool({
    name: "mem",
    label: "Memory",
    description: [
      "Single entry point for all persistent memory operations. In the main agent this is the only memory tool visible; specialized subagents get the individual mem_* tools they declare.",
      "",
      "Pass { action, params: {...} }. The action selects the underlying cuba-memorys operation; params are forwarded verbatim.",
      "",
      "CORE: search (cuba_faro), note (cuba_cronica), session (cuba_jornada), errors (cuba_expediente)",
      "ENTITY & RELATIONS: entity, relate",
      "DECISIONS & ERRORS: decide, report, resolve",
      "QUALITY: feedback, contra, judge",
      "INTROSPECTION: analytics, gaps, hypothesize",
      "MAINTENANCE: maintenance, forget",
      "UTILITY: calibrate, ingest, project, snapshot, sync, audit, buffer, trigger",
    ].join("\n"),
    promptSnippet: "Single memory dispatch. Use for every memory operation: search, note, session, errors, entity, relate, decide, report, analytics, maintenance, etc.",
    promptGuidelines: [
      "Use mem as the one memory interface in the main agent.",
      "Call mem with action='search' for memory search, action='note' to write observations, action='session' for session tracking, action='errors' for error history.",
      "Use mem with action='decide' to record architectural decisions, action='entity' for entity CRUD, action='maintenance' for graph maintenance.",
      "The params object maps to the underlying tool's arguments. See the action list in the description for what each supports.",
    ],
    parameters: Type.Object({
      action: Type.String({
        description:
          "Memory operation: search, note, session, errors, entity, relate, feedback, decide, report, resolve, contra, analytics, maintenance, forget, gaps, hypothesize, trigger, calibrate, ingest, project, snapshot, sync, audit, buffer, judge",
      }),
      params: Type.Optional(
        Type.Object({}, { description: "Action-specific parameters forwarded to the underlying tool" }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const mcpName = ACTION_MAP[params.action];
      if (!mcpName) {
        return {
          content: [
            {
              type: "text",
              text: `Unknown mem action: "${params.action}". Available: ${Object.keys(ACTION_MAP).join(", ")}`,
            },
          ],
          isError: true,
        };
      }
      try {
        return await client.callTool(mcpName, (params.params || {}) as Record<string, unknown>);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `mem dispatch error (${params.action}): ${message}` }],
          isError: true,
        };
      }
    },
  });
}
