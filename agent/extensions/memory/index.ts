/**
 * Memory Tools Extension — clean-named wrappers for cuba-memorys.
 *
 * Spawns the cuba-memorys binary, communicates via MCP stdio protocol,
 * registers 25 tools with `mem_*` names.
 *
 * Requires MEM_DATABASE_URL in environment.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { McpStdioClient } from "./mcp-client.js";
import { getMemoryTools, getMemDispatchTool } from "./tools.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARY_PATH = resolve(__dirname, "./cuba-memorys");

export default function (pi: ExtensionAPI) {
  const dbUrl = process.env.MEM_DATABASE_URL;

  if (!dbUrl) {
    // Register a session_start handler that shows mem: off in the status bar
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.setStatus("mem", ctx.ui.theme.fg("warning", "mem: off"));
    });
    return;
  }

  const client = new McpStdioClient(BINARY_PATH, {
    DATABASE_URL: dbUrl,
  });

  // Register all 25 individual memory tools
  const tools = getMemoryTools(client);
  for (const tool of tools) {
    pi.registerTool(tool);
  }

  // Register the mem dispatch tool (compact interface for non-core operations)
  pi.registerTool(getMemDispatchTool(client));

  // Auto-fold: replace 21 non-core mem_* tools with the mem dispatch in the prompt.
  // Only when no explicit tool filtering is already active (presets, --tools flag).
  // Subagents spawn with their own --tools and are unaffected.
  pi.on("session_start", async () => {
    const active = pi.getActiveTools();
    const allNames = pi.getAllTools().map((t) => t.name);

    // If tools have already been filtered (preset active, --tools used), don't interfere
    const sortedActive = [...active].sort().join(",");
    const sortedAll = [...allNames].sort().join(",");
    if (sortedActive !== sortedAll) return;

    const core = ["mem_session", "mem_search", "mem_note", "mem_errors"];
    const toFold = active.filter((t) => t.startsWith("mem_") && !core.includes(t));
    if (toFold.length === 0) return; // Already folded or no memory tools

    // Only fold if the dispatch is registered
    if (!allNames.includes("mem")) return;

    pi.setActiveTools([...active.filter((t) => !toFold.includes(t)), "mem"]);
  });

  // Show status indicator on session start
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("mem", ctx.ui.theme.fg("accent", "mem: on"));
  });

  // Clean up on session shutdown (normal interactive mode)
  pi.on("session_shutdown", async () => {
    client.stop();
  });

  // Fallback: clean up when agent ends in -p --no-session mode.
  // In print mode, session_shutdown may not fire, leaving the cuba-memorys
  // child process alive and preventing exit.
  //
  // We use process.on("exit") as a last resort because it's synchronous
  // and guaranteed to fire when the process actually exits.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    client.stop();
  };

  pi.on("agent_end", async () => {
    cleanup();
  });

  pi.on("session_shutdown", async () => {
    cleanup();
  });

  // Synchronous cleanup on process exit — last resort
  process.on("exit", cleanup);
}
