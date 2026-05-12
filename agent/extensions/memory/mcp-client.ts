/**
 * Minimal MCP (Model Context Protocol) client for stdio transport.
 * Implements only what's needed to call tools on cuba-memorys.
 */

import { type ChildProcess, spawn } from "node:child_process";

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class McpStdioClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private buffer = "";
  private command: string;
  private env: Record<string, string>;
  private initialized = false;

  constructor(command: string, env: Record<string, string> = {}) {
    this.command = command;
    this.env = env;
  }

  async start(): Promise<void> {
    if (this.process) return;

    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...this.env },
      });

      this.process.stdout!.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString();
        this.processBuffer();
      });

      this.process.stderr!.on("data", (_chunk: Buffer) => {
        // Silently consume stderr — server debug output
      });

      this.process.on("error", (err) => {
        reject(err);
      });

      this.process.on("exit", () => {
        this.process = null;
        this.initialized = false;
        for (const [, call] of this.pending) {
          clearTimeout(call.timeout);
          call.reject(new Error("MCP process exited"));
        }
        this.pending.clear();
      });

      // Initialize the MCP session
      this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "pi-memory-tools", version: "1.0.0" },
      })
        .then(() => {
          // Send initialized notification (no response expected)
          this.sendNotification("notifications/initialized", {});
          this.initialized = true;
          resolve();
        })
        .catch(reject);
    });
  }

  stop(): void {
    // Reject all pending calls so their promises resolve (don't hang)
    for (const [, call] of this.pending) {
      clearTimeout(call.timeout);
      call.reject(new Error("MCP client stopped"));
    }
    this.pending.clear();

    if (this.process) {
      // Destroy pipes to remove event loop references
      try { this.process.stdin?.destroy(); } catch {}
      try { this.process.stdout?.destroy(); } catch {}
      try { this.process.stderr?.destroy(); } catch {}
      // Remove all listeners
      this.process.removeAllListeners();
      // Kill the process
      try { this.process.kill(); } catch {}
      this.process = null;
      this.initialized = false;
    }
  }

  isRunning(): boolean {
    return this.process !== null && this.initialized;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.isRunning()) {
      await this.start();
    }

    const result = (await this.sendRequest("tools/call", {
      name,
      arguments: args,
    })) as McpToolResult;

    return result;
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        ...(params ? { params } : {}),
      };

      // Timeout after 60 seconds
      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 60_000);

      // Unref the timer so it doesn't prevent the process from exiting.
      // The child process itself keeps the event loop alive during tool execution.
      timeout.unref();

      this.pending.set(id, { resolve, reject, timeout });

      const message = JSON.stringify(request) + "\n";
      this.process!.stdin!.write(message, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    const notification = {
      jsonrpc: "2.0",
      method,
      ...(params ? { params } : {}),
    };
    const message = JSON.stringify(notification) + "\n";
    this.process!.stdin!.write(message);
  }

  private processBuffer(): void {
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        if (response.id !== undefined && this.pending.has(response.id)) {
          const call = this.pending.get(response.id)!;
          clearTimeout(call.timeout);
          this.pending.delete(response.id);

          if (response.error) {
            call.reject(new Error(`MCP error ${response.error.code}: ${response.error.message}`));
          } else {
            call.resolve(response.result);
          }
        }
      } catch {
        // Ignore non-JSON lines (server debug output mixed in)
      }
    }
  }
}
