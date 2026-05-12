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
import { getMemoryTools } from "./tools.js";

const BINARY_PATH =
  "/home/dude/github/mcp-servers/cuba-memorys/rust/target/release/cuba-memorys";

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

  // Register all memory tools
  const tools = getMemoryTools(client);
  for (const tool of tools) {
    pi.registerTool(tool);
  }

  // Show status indicator on session start
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("mem", ctx.ui.theme.fg("accent", "mem: on"));
  });

  // Clean up on session shutdown
  pi.on("session_shutdown", async () => {
    client.stop();
  });
}
