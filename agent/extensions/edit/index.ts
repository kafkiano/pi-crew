/**
 * Custom Edit Tool — exact text replacement.
 *
 * Replaces the built-in edit tool to provide:
 *   1. Literal matching (no post-JSON escape expansion — JSON.parse handles that)
 *   2. Detailed divergence diagnostics when matches fail
 *   3. Dry-run mode for pre-validation
 *
 * DESIGN PRINCIPLE: JSON.parse already converts \t → tab, \n → newline,
 * \\ → \, \" → ". Any remaining backslash sequences in oldText after JSON
 * parsing are INTENTIONAL literal text. Do NOT second-guess by re-expanding.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── position helpers ────────────────────────────────────────────────────────

function posToLineCol(content: string, pos: number): { line: number; col: number } {
	const before = content.slice(0, pos);
	const line = (before.match(/\n/g)?.length ?? 0) + 1;
	const lastNewline = before.lastIndexOf("\n");
	const col = lastNewline === -1 ? pos + 1 : pos - lastNewline;
	return { line, col };
}

// ── matching ────────────────────────────────────────────────────────────────

/** All byte-offset occurrences of needle in haystack (exact match). */
function findAllMatches(haystack: string, needle: string): number[] {
	if (!needle) return [];
	const offsets: number[] = [];
	let pos = 0;
	while ((pos = haystack.indexOf(needle, pos)) !== -1) {
		offsets.push(pos);
		pos += 1;
	}
	return offsets;
}

// ── error diagnostics ───────────────────────────────────────────────────────

/** Show a few lines around a position for context. */
function contextSnippet(content: string, pos: number, radius: number = 3): string {
	const lines = content.split("\n");
	const { line } = posToLineCol(content, pos);
	const start = Math.max(1, line - radius);
	const end = Math.min(lines.length, line + radius);
	const result: string[] = [];
	for (let i = start; i <= end; i++) {
		const marker = i === line ? ">>>" : "   ";
		result.push(`${marker} ${String(i).padStart(4, " ")} │ ${lines[i - 1]}`);
	}
	return result.join("\n");
}

/**
 * Find the first character position where expected and actual diverge.
 * Returns null if they're identical up to the shorter length (length mismatch).
 */
function findDivergence(
	expected: string,
	actual: string,
): { pos: number; expChar: string; actChar: string } | null {
	const minLen = Math.min(expected.length, actual.length);
	for (let i = 0; i < minLen; i++) {
		if (expected[i] !== actual[i]) {
			return { pos: i, expChar: expected[i], actChar: actual[i] };
		}
	}
	if (expected.length !== actual.length) {
		return {
			pos: minLen,
			expChar: expected[minLen] ?? "<EOF>",
			actChar: actual[minLen] ?? "<EOF>",
		};
	}
	return null;
}

/** Build a rich diagnostic when oldText is not found. */
function mismatchDiagnostic(
	original: string,
	needle: string,
	filePath: string,
): string {
	// Try to locate the first line of needle in the file.
	const needleFirstLine = needle.split("\n", 1)[0];
	const bracketPos = original.indexOf(needleFirstLine);

	if (bracketPos === -1) {
		// First line not found at all — show closest match via longest common prefix
		let bestScore = 0;
		let bestLine = 0;
		const fileLines = original.split("\n");
		for (let i = 0; i < fileLines.length; i++) {
			const score = commonPrefixLen(fileLines[i], needleFirstLine);
			if (score > bestScore) {
				bestScore = score;
				bestLine = i + 1;
			}
		}
		if (bestScore > 0) {
			const actualLine = fileLines[bestLine - 1];
			const div = findDivergence(needleFirstLine, actualLine);
			const divInfo = div
				? `\nDiverges at char ${div.pos}: expected '${escapeChar(div.expChar)}', found '${escapeChar(div.actChar)}'`
				: "";
			return `First line not found anywhere in ${filePath}.\nClosest match at line ${bestLine} (${bestScore} chars in common):${divInfo}\nExpected: ${needleFirstLine.slice(0, 120)}\nActual:   ${actualLine.slice(0, 120)}`;
		}
		return `No content resembling the oldText was found in ${filePath}.`;
	}

	// First line matches at bracketPos. Now find where the rest diverges.
	const actualTail = original.slice(bracketPos, bracketPos + needle.length);
	const div = findDivergence(needle, actualTail);

	if (!div) {
		// Shouldn't happen if match failed, but handle gracefully
		return `First line matches at line ${posToLineCol(original, bracketPos).line}, but full match failed for unknown reason.`;
	}

	// Build a line-aware diff around the divergence
	const divLineCol = posToLineCol(needle, div.pos);
	const actualDivLineCol = posToLineCol(actualTail, div.pos);

	const sourceLines = original.split("\n");
	const bracketLine = posToLineCol(original, bracketPos).line;
	const divSourceLine = bracketLine + actualDivLineCol.line - 1;

	let msg = `Found matching first line at line ${bracketLine}, but text diverges at line ${divSourceLine}, col ${actualDivLineCol.col}:\n`;

	// Show the expected line and actual line at divergence
	const expLines = needle.split("\n");
	const expDivLine = expLines[divLineCol.line - 1] ?? "";
	const actDivLine = sourceLines[divSourceLine - 1] ?? "";
	const arrowPad = " ".repeat(divLineCol.col);

	msg += `\nExpected (line ${divLineCol.line} of oldText):\n  ${expDivLine}\n  ${arrowPad}^-- char ${escapeChar(div.expChar)} not found\n`;
	msg += `\nActual (line ${divSourceLine}):\n  ${actDivLine}\n  ${arrowPad}^-- char ${escapeChar(div.actChar)} here\n`;

	// Show surrounding context
	msg += `\nFile context around line ${divSourceLine}:\n`;
	const ctxStart = Math.max(1, divSourceLine - 2);
	const ctxEnd = Math.min(sourceLines.length, divSourceLine + 2);
	for (let i = ctxStart; i <= ctxEnd; i++) {
		const marker = i === divSourceLine ? ">>>" : "   ";
		msg += `${marker} ${String(i).padStart(4, " ")} │ ${sourceLines[i - 1]}\n`;
	}

	return msg;
}

/** Length of common prefix between two strings. */
function commonPrefixLen(a: string, b: string): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return i;
}

/** Escape a character for display (show \n, \t, etc. or the raw char). */
function escapeChar(ch: string): string {
	if (ch === "\n") return "\\n";
	if (ch === "\t") return "\\t";
	if (ch === "\r") return "\\r";
	if (ch === "<EOF>") return ch;
	return ch.length === 1 ? `'${ch}'` : ch;
}

// ── emoji shaming ───────────────────────────────────────────────────────────

/** Extract unique emoji characters from text. Broad match, slight over-catch is fine — this is a warning, not a gate. */
function findEmojis(text: string): string[] {
	// Extended_Pictographic covers most emojis; add common BMP symbols that smug types slip in.
	const re = /\p{Extended_Pictographic}/gu;
	const matches = text.match(re);
	if (!matches) return [];
	return [...new Set(matches)];
}

// ── apply edits ─────────────────────────────────────────────────────────────

function applyEdits(original: string, replacements: Array<{ offset: number; oldLen: number; newText: string }>): string {
	let modified = original;
	for (let i = replacements.length - 1; i >= 0; i--) {
		const r = replacements[i];
		modified = modified.slice(0, r.offset) + r.newText + modified.slice(r.offset + r.oldLen);
	}
	return modified;
}

// ── tool definition ─────────────────────────────────────────────────────────

const editTool = defineTool({
	name: "edit",
	label: "Edit",
	description: [
		"Edit a single file using exact text replacement.",
		"Every edits[].oldText must match a unique, non-overlapping region of the original file.",
		"If two changes affect the same block or nearby lines, merge them into one edit instead.",
		"Do not include large unchanged regions just to connect distant changes.",
		"oldText is matched LITERALLY against file content (JSON.parse already handles \\t, \\n, \\\\ escapes).",
		"Use dryRun=true to validate edits without writing.",
	].join(" "),
	promptSnippet:
		"Edit files with exact text replacement — literal matching of oldText against file content.",
	promptGuidelines: [
		"Use edit for precise changes. Each edits[].oldText must match exactly once.",
		"oldText is matched LITERALLY — copy the exact text from the file. JSON escapes (\\t, \\n, \\\\) are handled by the JSON parser.",
		"Keep oldText as small as possible while still being unique in the file.",
		"Do not pad oldText with large unchanged regions — use minimal unique snippets.",
		"If two changes touch the same block, merge them into one edit instead of two.",
		"Use dryRun=true first to verify oldText matches before committing.",
	],

	parameters: Type.Object({
		path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
		edits: Type.Array(Type.Object({
			oldText: Type.String({ description: "Exact text to find and replace. Matched literally against file content." }),
			newText: Type.String({ description: "Replacement text." }),
		}), { description: "One or more targeted replacements. Each oldText must be unique." }),
		dryRun: Type.Optional(Type.Boolean({ description: "If true, validate all edits and report what would change, but don't write." })),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const filePath = path.isAbsolute(params.path) ? params.path : path.resolve(ctx.cwd, params.path);
		const dryRun = params.dryRun === true;

		let original: string;
		try {
			original = fs.readFileSync(filePath, "utf-8");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Cannot read ${params.path}: ${msg}` }],
				isError: true,
			};
		}

		// Validate all edits against the ORIGINAL content (not incremental).
		const replacements: Array<{ offset: number; oldLen: number; newText: string; editIndex: number }> = [];

		for (let i = 0; i < params.edits.length; i++) {
			const edit = params.edits[i];
			const oldText = edit.oldText;
			const newText = edit.newText;

			if (!oldText) {
				return {
					content: [{ type: "text", text: `Edit ${i + 1}: oldText is empty.` }],
					isError: true,
				};
			}

			const matches = findAllMatches(original, oldText);

			if (matches.length === 0) {
				const diag = mismatchDiagnostic(original, oldText, params.path);
				return {
					content: [{
						type: "text",
						text: [
							`Edit ${i + 1}: oldText not found in ${params.path}.`,
							"",
							diag,
							"",
							`Searched for (${oldText.length} chars):`,
							"```",
							oldText.length > 300 ? oldText.slice(0, 300) + "..." : oldText,
							"```",
						].join("\n"),
					}],
					isError: true,
				};
			}

			if (matches.length > 1) {
				const locations = matches.slice(0, 5).map(m => {
					const { line, col } = posToLineCol(original, m);
					return `  line ${line}, col ${col}`;
				}).join("\n");
				const extra = matches.length > 5 ? `\n  ... and ${matches.length - 5} more` : "";
				return {
					content: [{
						type: "text",
						text: `Edit ${i + 1}: oldText matches ${matches.length} locations in ${params.path}. Must be unique.\n\nMatching locations:\n${locations}${extra}\n\nMake oldText longer or more specific.`,
					}],
					isError: true,
				};
			}

			replacements.push({
				offset: matches[0],
				oldLen: oldText.length,
				newText,
				editIndex: i,
			});
		}

		// Check for overlapping edits (sort by offset first).
		replacements.sort((a, b) => a.offset - b.offset);
		for (let i = 0; i < replacements.length - 1; i++) {
			const current = replacements[i];
			const next = replacements[i + 1];
			const currentEnd = current.offset + current.oldLen;
			if (currentEnd > next.offset) {
				const { line: l1 } = posToLineCol(original, current.offset);
				const { line: l2 } = posToLineCol(original, next.offset);
				return {
					content: [{
						type: "text",
						text: `Edits ${current.editIndex + 1} and ${next.editIndex + 1} overlap (lines ${l1}-${l2}). Merge them into a single edit with a larger oldText.`,
					}],
					isError: true,
				};
			}
		}

		// Scan for emojis in the regions being touched.
		const emojisFound = new Set<string>();
		for (const r of replacements) {
			const region = original.slice(r.offset, r.offset + r.oldLen);
			for (const e of findEmojis(region)) emojisFound.add(e);
			for (const e of findEmojis(r.newText)) emojisFound.add(e);
		}
		const emojiWarning = emojisFound.size > 0
			? [
				"",
				`\u{1F6E0} Emoji detected in edited region: ${[...emojisFound].join(" ")}`,
				"   grep won't thank you. awk will weep. Your terminal font is already filing a complaint.",
			].join("\n")
			: "";

		// Dry run: validate only, don't write.
		if (dryRun) {
			return {
				content: [{
					type: "text",
					text: `[dry-run] Would apply ${replacements.length} edit(s) to ${params.path}. All oldText matches are valid and non-overlapping.${emojiWarning}`,
				}],
			};
		}

		// Apply edits (end-to-start to preserve offsets).
		const modified = applyEdits(original, replacements);

		try {
			fs.writeFileSync(filePath, modified, "utf-8");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Cannot write ${params.path}: ${msg}` }],
				isError: true,
			};
		}

		return {
			content: [{
				type: "text",
				text: `Applied ${replacements.length} edit(s) to ${params.path}${emojiWarning}`,
			}],
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(editTool);
}
