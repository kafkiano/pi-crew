/**
 * Temperature Extension — injects per-model/per-preset temperature into API requests.
 *
 * Config sources, in priority order:
 *   1. Agent frontmatter   agents/*.md        temperature: 0.3
 *   2. Preset config       presets.json       "temperature": 0.5
 *   3. temperature.json    per-model          "deepseek-v4-pro": 0.2
 *   4. temperature.json    fallback           "default": 1.0
 *
 * Since the before_provider_request payload only carries model + reasoning_effort
 * (not preset/agent name), we build a compound lookup key:
 *
 *   "model:reasoning_effort" → temperature
 *
 * At request time, we extract model + reasoning_effort from the payload and
 * look up the most specific match.
 *
 * Thinking level → reasoning_effort mapping (Ollama Cloud DEFAULT):
 *   off → none    minimal → minimal    low → low
 *   medium → medium    high → high    xhigh → max
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, parse as parsePath } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// Pi thinking level → Ollama Cloud reasoning_effort (DEFAULT map)
const THINKING_TO_REASONING: Record<string, string> = {
  off: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
};

type TempMap = Map<string, number>; // "model:reasoning_effort" → temperature

// --- JSON config loader ---

function loadJsonConfig(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* malformed */ }
  return null;
}

// --- temperature.json ---

interface TemperatureJsonConfig {
  models: Map<string, number>;  // model → temperature
  defaultTemp?: number;
}

function loadTemperatureJson(): TemperatureJsonConfig {
  const models = new Map<string, number>();
  let defaultTemp: number | undefined;

  const data = loadJsonConfig(join(getAgentDir(), "temperature.json"));
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "number" && isFinite(value)) {
        if (key === "default") {
          defaultTemp = value;
        } else {
          models.set(key, value);
        }
      }
    }
  }

  return { models, defaultTemp };
}

// --- presets.json ---

function loadPresetTemperatures(): TempMap {
  const map: TempMap = new Map();
  const data = loadJsonConfig(join(getAgentDir(), "presets.json"));
  if (!data) return map;

  for (const [, preset] of Object.entries(data)) {
    if (!preset || typeof preset !== "object") continue;
    const p = preset as Record<string, unknown>;
    if (typeof p.temperature !== "number") continue;

    const model = typeof p.model === "string" ? p.model : undefined;
    const thinkingLevel = typeof p.thinkingLevel === "string" ? p.thinkingLevel : undefined;
    if (!model || !thinkingLevel) continue;

    const reasoningEffort = THINKING_TO_REASONING[thinkingLevel];
    if (!reasoningEffort) continue;

    const key = `${model}:${reasoningEffort}`;
    if (!map.has(key)) {
      map.set(key, p.temperature);
    }
  }

  return map;
}

// --- agents/*.md ---

function parseAgentFrontmatter(content: string): Record<string, string> | null {
  // Match YAML frontmatter between --- delimiters
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) fm[key] = value;
  }
  return fm;
}

function loadAgentTemperatures(): TempMap {
  const map: TempMap = new Map();
  const agentsDir = join(getAgentDir(), "agents");

  let entries: string[];
  try {
    entries = readdirSync(agentsDir);
  } catch {
    return map;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    let content: string;
    try {
      content = readFileSync(join(agentsDir, entry), "utf-8");
    } catch {
      continue;
    }

    const fm = parseAgentFrontmatter(content);
    if (!fm) continue;

    // temperature must be explicitly declared
    const tempRaw = fm.temperature;
    if (tempRaw === undefined) continue;
    const temperature = Number(tempRaw);
    if (!isFinite(temperature)) continue;

    // Model format: "provider/model" → strip provider prefix
    const modelRaw = fm.model;
    if (!modelRaw) continue;
    const model = modelRaw.includes("/") ? modelRaw.split("/").pop()! : modelRaw;

    // Thinking: "high", "xhigh", etc.
    const thinking = fm.thinking;
    if (!thinking) continue;
    const reasoningEffort = THINKING_TO_REASONING[thinking];
    if (!reasoningEffort) continue;

    const key = `${model}:${reasoningEffort}`;
    if (!map.has(key)) {
      map.set(key, temperature);
    }
  }

  return map;
}

// --- Payload helpers ---

interface RequestPayload {
  model?: string;
  reasoning_effort?: string;
  temperature?: number;
  [key: string]: unknown;
}

// --- Main ---

export default function (pi: ExtensionAPI) {
  // Build priority chain at startup
  const tempJson = loadTemperatureJson();
  const presetTemps = loadPresetTemperatures();
  const agentTemps = loadAgentTemperatures();

  // Merge: agents override presets override temperature.json
  const compound = new Map<string, number>();
  for (const [model, temp] of tempJson.models) {
    compound.set(model, temp);
  }
  for (const [key, temp] of presetTemps) {
    compound.set(key, temp);
  }
  for (const [key, temp] of agentTemps) {
    compound.set(key, temp);
  }

  // Nothing configured at all
  if (compound.size === 0 && tempJson.defaultTemp === undefined) return;

  pi.on("before_provider_request", async (event) => {
    const payload = event.payload as RequestPayload;
    if (!payload || typeof payload !== "object") return;

    const model = payload.model;
    if (!model) return;

    // Priority chain:
    //   1. model:reasoning_effort key (agent/preset-specific)
    //   2. model-only key (temperature.json per-model)
    //   3. default (temperature.json fallback)
    let temp: number | undefined;

    if (payload.reasoning_effort) {
      temp = compound.get(`${model}:${payload.reasoning_effort}`);
    }
    if (temp === undefined) {
      temp = compound.get(model);
    }
    if (temp === undefined) {
      temp = tempJson.defaultTemp;
    }
    if (temp === undefined) return;

    // Only inject if not already set
    if (payload.temperature === undefined) {
      payload.temperature = temp;
    }
  });
}
