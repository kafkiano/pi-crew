/**
 * Memory Monitor Extension
 *
 * Simplified context-aware memory management for cuba-memorys integration.
 *
 * Features:
 * 1. Context window monitoring — shows usage in footer/status
 * 2. Turn-based nudges — every N turns, remind to archive learnings
 * 3. 80% compaction — auto-triggers compaction to free context
 *
 * Design philosophy:
 * - Passive by default: status indicator, not intrusive popups
 * - Nudges via injected system messages, not blocking UI
 * - Simple turn counter — no complex threshold tracking
 * - Captures early-session learnings (no 60% waiting)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// Configuration
const NUDGE_INTERVAL = 10;    // Nudge every N turns from the start
const COMPACT_THRESHOLD = 80; // Auto-trigger compaction at this %

// Track state across turns
let turnCount = 0;
let lastCompactAt = 0;    // Turn index of last compact
let sessionStarted = false;

export default function memoryMonitor(pi: ExtensionAPI) {
	let enabled = true;

	// ── Status widget ──────────────────────────────────────────────
	function updateStatus(ctx: ExtensionContext) {
		if (!enabled) {
			ctx.ui.setStatus("mem", undefined);
			return;
		}

		const usage = ctx.getContextUsage();
		if (!usage || usage.percent === null) {
			ctx.ui.setStatus("mem", "brain: ready");
			return;
		}

		const pct = Math.round(usage.percent);
		const emoji = pct < 50 ? "🟢" : pct < 70 ? "🟡" : "🔴";
		ctx.ui.setStatus("mem", `${emoji} ctx: ${pct}%`);
	}

	// ── Context monitoring on each turn ────────────────────────────
	pi.on("turn_end", (event, ctx) => {
		if (!enabled) return;

		turnCount++;
		updateStatus(ctx);

		const usage = ctx.getContextUsage();
		if (!usage || usage.percent === null) return;

		const pct = usage.percent;
		const turnIndex = event.turnIndex;

		// 80% threshold — trigger compaction (once per threshold crossing)
		if (pct >= COMPACT_THRESHOLD && lastCompactAt < turnIndex - 2) {
			lastCompactAt = turnIndex;

			ctx.compact({
				customInstructions: "Prioritize: active task context, recent decisions, unresolved errors. Summarize completed sub-tasks briefly.",
				onComplete: () => {
					ctx.ui.notify("🧠 Context compacted — memory preserved", "info");
				},
				onError: (err) => {
					ctx.ui.notify(`Compaction failed: ${err.message}`, "error");
				},
			});
		}
	});

	// ── Turn-based nudges via injected message ─────────────────────
	pi.on("before_agent_start", (_event, ctx) => {
		if (!enabled) return;

		// Nudge every N turns from the start
		if (turnCount > 0 && turnCount % NUDGE_INTERVAL === 0) {
			return {
				message: {
					customType: "memory-monitor",
					content: `[Turn ${turnCount}] Archive important findings to cuba-memorys. Use the memory-write subagent to persist facts, decisions, errors, and patterns learned so far.`,
					display: false,
				},
			};
		}
	});

	// ── Session start ──────────────────────────────────────────────
	pi.on("session_start", (_event, ctx) => {
		if (!enabled) return;

		sessionStarted = true;
		turnCount = 0;
		lastCompactAt = 0;

		updateStatus(ctx);
	});

	// ── Session shutdown ───────────────────────────────────────────
	pi.on("session_shutdown", () => {
		if (!enabled || !sessionStarted) return;
		sessionStarted = false;
	});

	// ── Toggle command ─────────────────────────────────────────────
	pi.registerCommand("mem", {
		description: "Toggle memory monitor",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				ctx.ui.notify("Memory monitor enabled", "info");
				updateStatus(ctx);
			} else {
				ctx.ui.setStatus("mem", undefined);
				ctx.ui.notify("Memory monitor disabled", "info");
			}
		},
	});
}
