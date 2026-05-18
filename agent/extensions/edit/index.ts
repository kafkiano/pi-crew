/**
 * Custom Edit Tool — exact text replacement with tab normalization.
 *
 * Fixes the built-in edit tool's inability to handle tab-indented files
 * by expanding escape sequences (\t, \n) in oldText before matching.
 * Also provides better error messages showing context around failed matches.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Expand escape sequences that LLMs commonly output in oldText */
function normalizeMatchText(text: string): string {
	return text
		.replace(/\\t/g, "\t")
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r");
}

/** Find line:col for a position in content */
function posToLineCol(content: string, pos: number): { line: number; col: number } {
	const before = content.slice(0, pos);
	const line = (before.match(/\n/g)?.length ?? 0) + 1;
	const lastNewline = before.lastIndexOf("\n");
	const col = lastNewline === -1 ? pos + 1 : pos - lastNewline;
	return { line, col };
}

/**
 * Find all occurrences of needle in haystack.
 * Uses exact matching (after normalization). Returns byte offsets.
 */
function findAllMatches(haystack: string, needle: string): number[] {
	if (!needle) return [];
	const offsets: number[] = [];
	let pos = 0;
	while ((pos = haystack.indexOf(needle, pos)) !== -1) {
		offsets.push(pos);
		pos += 1; // allow overlapping matches
	}
	return offsets;
}

/** Show a few lines around a position for error context */
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

const editTool = defineTool({
	name: "edit",
	label: "Edit",
	description: [
		"Edit a single file using exact text replacement.",
		"Every edits[].oldText must match a unique, non-overlapping region of the original file.",
		"If two changes affect the same block or nearby lines, merge them into one edit instead.",
		"Do not include large unchanged regions just to connect distant changes.",
		"Supports \\t, \\n escape sequences in oldText (expanded before matching).",
	].join(" "),
	promptSnippet:
		"Edit files with exact text replacement — supports \\t, \\n escapes for tab-indented files.",
	promptGuidelines: [
		"Use edit for precise changes. Each edits[].oldText must match exactly once.",
		"The oldText is matched after expanding \\t → tab, \\n → newline.",
		"Keep oldText as small as possible while still being unique in the file.",
		"Do not pad oldText with large unchanged regions — use minimal unique snippets.",
		"If two changes touch the same block, merge them into one edit instead of two.",
	],

	parameters: Type.Object({
		path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
		edits: Type.Array(Type.Object({
			oldText: Type.String({ description: "Exact text to find and replace. \\t and \\n escapes are expanded." }),
			newText: Type.String({ description: "Replacement text. \\t and \\n escapes are expanded." }),
		}), { description: "One or more targeted replacements. Each oldText must be unique." }),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const filePath = path.isAbsolute(params.path) ? params.path : path.resolve(ctx.cwd, params.path);

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

		// Process edits - all edits match against the ORIGINAL content, not incrementally
		let content = original;
		const replacements: Array<{ offset: number; oldLen: number; newText: string; editIndex: number }> = [];

		for (let i = 0; i < params.edits.length; i++) {
			const edit = params.edits[i];
			const normalizedOld = normalizeMatchText(edit.oldText);
			const normalizedNew = normalizeMatchText(edit.newText);

			if (!normalizedOld) {
				return {
					content: [{ type: "text", text: `Edit ${i + 1}: oldText is empty after normalization.` }],
					isError: true,
				};
			}

			// Find all occurrences in the ORIGINAL (not modified) content
			const matches = findAllMatches(original, normalizedOld);

			if (matches.length === 0) {
				// Try to find a close match for debugging
				const firstLine = normalizedOld.split("\n")[0].trim();
				const firstLinePos = original.indexOf(firstLine);
				const context = firstLinePos !== -1
					? `\n\nFound similar content at line ${posToLineCol(original, firstLinePos).line} (first line match only):\n${contextSnippet(original, firstLinePos)}`
					: "\n\nCould not find any matching content in file.";

				return {
					content: [{
						type: "text",
						text: `Edit ${i + 1}: oldText not found in ${params.path}.${context}\n\nSearched for (${normalizedOld.length} chars):\n\`\`\`\n${normalizedOld.slice(0, 200)}${normalizedOld.length > 200 ? "..." : ""}\n\`\`\``,
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
				oldLen: normalizedOld.length,
				newText: normalizedNew,
				editIndex: i,
			});
		}

		// Check for overlapping edits
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

		// Apply all edits from end to start to preserve offsets
		let modified = original;
		for (let i = replacements.length - 1; i >= 0; i--) {
			const r = replacements[i];
			modified = modified.slice(0, r.offset) + r.newText + modified.slice(r.offset + r.oldLen);
		}

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
				text: `Applied ${replacements.length} edit(s) to ${params.path}`,
			}],
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(editTool);
}
