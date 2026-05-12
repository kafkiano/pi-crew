/**
 * Search Tool — BM25-scored code search with subword tokenization.
 *
 * Wraps search.sh as a registered Pi tool. The LLM can call it to search
 * the local codebase with ranked results instead of raw grep.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "extensions/search/search.sh");

function runSearch(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		execFile("bash", [SCRIPT, ...args], { timeout: 30_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
			resolve({
				stdout: stdout ?? "",
				stderr: stderr ?? "",
				code: err ? (err as any).code ?? 1 : 0,
			});
		});
	});
}

const searchTool = defineTool({
	name: "search",
	label: "Search",
	description:
		"Search the local codebase using BM25-ranked grep with subword tokenization. " +
		"Matches camelCase/snake_case/kebab identifiers. Returns ranked JSON results " +
		"with file, line, score, and content.",
	promptSnippet:
		"Search the codebase with BM25 ranking — matches camelCase/snake_case identifiers, ranks by relevance",
	promptGuidelines: [
		"Use search to find code by concept or identifier — it handles camelCase, snake_case, kebab-case splitting automatically.",
		"Use search with mode=files to find which files are relevant before reading them.",
		"Use search with context>0 when you need to understand surrounding code, not just the match line.",
		"Prefer search over grep for codebase exploration — it ranks results by relevance instead of dumping all matches.",
	],

	parameters: Type.Object({
		query: Type.String({ description: "Search query. Supports multi-word queries; identifiers are split into subwords automatically." }),
		directory: Type.Optional(Type.String({ description: "Directory to search in (default: current working directory)." })),
		top: Type.Optional(Type.Number({ description: "Number of top results to return (default: 10)." })),
		mode: Type.Optional(
			Type.Union([Type.Literal("lines"), Type.Literal("files")], {
				description: "lines = rank individual lines (default); files = rank whole files, show top 3 representative lines each.",
			}),
		),
		context: Type.Optional(Type.Number({ description: "Number of context lines before/after each match (default: 0)." })),
		min_score: Type.Optional(Type.Number({ description: "Drop results below this score (default: 0)." })),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const args: string[] = [];

		if (params.top != null) args.push("-k", String(params.top));
		else args.push("-k", "10"); // sensible default for LLM consumption

		if (params.mode === "files") args.push("-f");
		if (params.context != null) args.push("-c", String(params.context));
		if (params.min_score != null) args.push("-m", String(params.min_score));

		args.push("--"); // end options
		args.push(params.query);
		args.push(params.directory ?? ctx.cwd);

		const { stdout, stderr, code } = await runSearch(args);

		if (code !== 0) {
			return {
				content: [{ type: "text", text: `Search failed (exit ${code}): ${stderr}` }],
				details: { error: true, code },
				isError: true,
			};
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(stdout);
		} catch {
			return {
				content: [{ type: "text", text: `Search returned invalid JSON:\n${stdout.slice(0, 500)}` }],
				details: { error: true },
				isError: true,
			};
		}

		const results = parsed as Array<Record<string, unknown>>;
		if (results.length === 0) {
			return {
				content: [{ type: "text", text: `No results for "${params.query}".` }],
				details: { count: 0 },
			};
		}

		// Format for LLM consumption — compact but readable
		const lines = results.map((r, i) => {
			const ctx_before = (r.context_before as string[]) ?? [];
			const ctx_after = (r.context_after as string[]) ?? [];
			let block = `[${i + 1}] ${r.file}:${r.line} (score: ${(r.score as number).toFixed(2)}, matches: ${r.matches})`;
			for (const line of ctx_before) block += `\n    ${line}`;
			block += `\n  > ${r.content}`;
			for (const line of ctx_after) block += `\n    ${line}`;
			return block;
		});

		return {
			content: [{ type: "text", text: lines.join("\n\n") }],
			details: { count: results.length, raw: results },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(searchTool);
}
