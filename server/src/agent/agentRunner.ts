import path from "path";
import fs from "fs/promises";

import { openaiClient } from "../config/azureOpenAI";
import { azureAnthropicMessagesCreate, extractClaudeText } from "../config/azureAnthropic";
import { PROJECT_ROOT } from "../config/projectConfig";
import { MODEL_PROFILES } from "../config/modelProfiles";

import {
  listFiles,
  readFileWithRange,
  searchInFiles,
  applyPatch,
  findFilesByName,
  writeFileRaw,
} from "../tools/fileTools";

import { getAstOutline, tsCheck } from "../tools/tsTools";
import { runTests, runBuild, runLint } from "../tools/execTools";
import { checkActionAgainstPolicy, PolicyConfig } from "../tools/policyTools";

import { tools } from "./toolsRegistry";
import { RunStepToolUsage } from "../runs/runTypes";
import { RunAgentInternalParams, RunAgentResult, RunMode } from "./agentTypes";

/* ===========================
   Turvarajat
=========================== */
const MAX_TOOL_ROUNDS = 10;
const MAX_TOOL_ARGS_CHARS = 200_000;
const MAX_WRITE_CHARS = 400_000;
const MAX_PATCH_CHARS = 400_000;

const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/coverage/**",
  "**/*.log",
];

/* ===========================
   Usage & Cost
=========================== */
type UsageSnapshot = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

function calculateCostFromUsage(
  usage: UsageSnapshot,
  modelId: keyof typeof MODEL_PROFILES
) {
  const profile = MODEL_PROFILES[modelId];

  const usd =
    (usage.promptTokens / 1_000_000) * profile.inputCostPer1M +
    (usage.completionTokens / 1_000_000) * profile.outputCostPer1M;

  return {
    usd,
    eur: usd * 0.93, // karkea muunnos
  };
}

/* ===========================
   PLAN vs EXECUTE toolit
=========================== */
const PLAN_ALLOWED_TOOLS = new Set([
  "read_file",
  "list_files",
  "search_in_files",
  "find_files_by_name",
  "ts_get_outline",
]);

const EXEC_ALLOWED_TOOLS = new Set([
  ...PLAN_ALLOWED_TOOLS,
  "write_file",
  "apply_patch",
  "ts_check",
  "run_tests",
  "run_build",
  "run_lint",
]);

function isToolAllowed(mode: RunMode, toolName: string) {
  const set = mode === "plan" ? PLAN_ALLOWED_TOOLS : EXEC_ALLOWED_TOOLS;
  return set.has(toolName);
}

/* ===========================
   Polku- ja policy-apurit
=========================== */
function isBlockedPath(absPath: string): boolean {
  const p = absPath.split(path.sep).join("/").toLowerCase();
  if (
    p.includes("/.git/") ||
    p.includes("/node_modules/") ||
    p.includes("/dist/") ||
    p.includes("/build/") ||
    p.includes("/coverage/")
  ) return true;

  const base = path.basename(p);
  if (base === ".env" || base.startsWith(".env.")) return true;

  return false;
}

function buildDefaultPolicy(projectRoot: string): PolicyConfig {
  return {
    projectRoot,
    allowedPaths: [projectRoot],
    readOnlyPaths: [],
    maxFilesChanged: 5,
    maxTotalChangedLines: 800,
  };
}

function safeJsonParseArgs(raw: unknown): any {
  if (typeof raw !== "string") throw new Error("Tool arguments must be a JSON string");
  if (raw.length > MAX_TOOL_ARGS_CHARS) throw new Error("Tool arguments too large");
  return JSON.parse(raw);
}

function asNonEmptyString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`Invalid or missing field: ${field}`);
  }
  return v;
}

function asOptionalPositiveInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  return undefined;
}

function normalizeSlashes(p: string) {
  return p.split(path.sep).join("/");
}

function toRel(root: string, abs: string) {
  return normalizeSlashes(path.relative(root, abs));
}

async function resolveProjectPath(root: string, userPath: string) {
  if (path.isAbsolute(userPath)) throw new Error("Absolute paths are not allowed");
  const rootAbs = path.resolve(root);
  const joined = path.resolve(rootAbs, userPath);
  if (!joined.startsWith(rootAbs)) throw new Error("Path escapes project root");
  return joined;
}

/* ===========================
   ToolCall-tyyppi
=========================== */
type ToolCallUnion =
  | { id: string; function: { name: string; arguments: string } }
  | { id: string; custom: { name: string; input: unknown } };

/* ===========================
   Anthropic tool mapper (MINIMI LISÄYS)
=========================== */
function mapOpenAiToolsToAnthropic(openAiTools: any[]) {
  return (openAiTools ?? [])
    .filter((t) => t?.type === "function" && typeof t?.function?.name === "string")
    .map((t) => ({
      name: String(t.function.name),
      description: String(t.function.description ?? ""),
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
}

/* ===========================
   AGENT LOOP
=========================== */
export async function runAgentInternal(
  params: RunAgentInternalParams & { modelId: keyof typeof MODEL_PROFILES }
): Promise<RunAgentResult> {

  const mode: RunMode = params.mode ?? "execute";
  const projectRoot = path.resolve(params.projectRoot || PROJECT_ROOT);
  const policy = buildDefaultPolicy(projectRoot);

  const modelProfile = MODEL_PROFILES[params.modelId];
  if (!modelProfile) {
    throw new Error(`Unknown modelId: ${params.modelId}`);
  }

  const filteredTools = (tools as any[]).filter(
    (t) => typeof t?.function?.name === "string" &&
      isToolAllowed(mode, t.function.name)
  );

  const messages: any[] = [
    { role: "system", content: params.systemPrompt },
    { role: "user", content: params.userMessage },
  ];

  const toolUsage: RunStepToolUsage[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  //Mallin valinta konsoliin.
  console.log(
    `[AGENT] mode=${mode} role=${params.role} model=${params.modelId} deployment=${modelProfile.deployment}`
  );

  const maxRounds = mode === "plan" ? 25 : MAX_TOOL_ROUNDS;

  // ===========================
  // Anthropic: MINIMI MUUTOS
  // - lisää tools
  // - tee tool-loop (tool_use -> tool_result)
  // ===========================
  if (modelProfile.provider === "anthropic") {
    const system = messages
      .filter((m: any) => m.role === "system")
      .map((m: any) => String(m.content ?? ""))
      .join("\n");

    // Muunna OpenAI tool-skeema Anthropicin tool-skeemaksi
    const claudeTools = mapOpenAiToolsToAnthropic(filteredTools);

    // Pidä Claude-keskustelu erillään OpenAI "tool"-viesteistä
    const claudeMessages: any[] = messages
      .filter((m: any) => m.role === "user" || m.role === "assistant")
      .map((m: any) => ({
        role: m.role,
        content: [{ type: "text" as const, text: String(m.content ?? "") }],
      }));

    let lastText = "";
    for (let round = 1; round <= maxRounds; round++) {
      const resp = await azureAnthropicMessagesCreate({
        model: modelProfile.deployment,
        max_tokens: 1024,
        system: system || undefined,
        messages: claudeMessages,
        tools: claudeTools, // <-- PAKOLLINEN
        temperature: 0,
      });

      lastText = extractClaudeText(resp) || lastText;

      totalPromptTokens += resp?.usage?.input_tokens ?? 0;
      totalCompletionTokens += resp?.usage?.output_tokens ?? 0;

      const usageSummary: UsageSnapshot = {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
      };

      const contentBlocks = resp?.content ?? [];
      const toolUses = (contentBlocks as any[]).filter((b) => b?.type === "tool_use");

      // Ei tool_use -> valmis tekstivastaus
      if (toolUses.length === 0) {
        const text = extractClaudeText(resp);
        return {
          output: text,
          rounds: round,
          toolUsage,
          usage: usageSummary,
          cost: calculateCostFromUsage(usageSummary, params.modelId),
        };
      }

      // Tallenna assistantin tool_use -blokit keskusteluun
      claudeMessages.push({ role: "assistant", content: contentBlocks });

      // Suorita toolit ja palauta tool_resultit
      const toolResultBlocks: any[] = [];

      for (const tu of toolUses) {
        const toolName = String(tu?.name ?? "");
        const toolId = String(tu?.id ?? "");
        const parsedArgs = tu?.input ?? {};

        if (!toolName || !toolId) {
          const err = "Malformed tool_use";
          toolUsage.push({ toolName: toolName || "(missing)", ok: false, error: err } as any);
          continue;
        }

        if (!isToolAllowed(mode, toolName)) {
          const err = `Tool not allowed in mode=${mode}: ${toolName}`;
          toolUsage.push({ toolName, ok: false, error: err } as any);

          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolId,
            is_error: true,
            content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: err }) }],
          });
          continue;
        }

        let toolResult: any;

        try {
          if (toolName === "read_file") {
            const abs = await resolveProjectPath(projectRoot, asNonEmptyString(parsedArgs.path, "path"));
            toolResult = await readFileWithRange(abs, parsedArgs);
          } else if (toolName === "write_file") {
            const abs = await resolveProjectPath(projectRoot, parsedArgs.filePath);
            toolResult = await writeFileRaw(abs, parsedArgs.content);
          } else if (toolName === "apply_patch") {
            const abs = await resolveProjectPath(projectRoot, parsedArgs.filePath);
            toolResult = await applyPatch({ ...parsedArgs, filePath: abs });
          } else if (toolName === "list_files") {
            toolResult = await listFiles({ cwd: projectRoot, patterns: ["**/*"], ignore: DEFAULT_IGNORE_PATTERNS });
          } else if (toolName === "search_in_files") {
            toolResult = await searchInFiles({ cwd: projectRoot, ...parsedArgs });
          } else if (toolName === "find_files_by_name") {
            toolResult = await findFilesByName({ cwd: projectRoot, ...parsedArgs });
          } else if (toolName === "ts_get_outline") {
            const abs = await resolveProjectPath(projectRoot, parsedArgs.filePath);
            toolResult = await getAstOutline(abs, { projectRoot });
          } else if (toolName === "ts_check") {
            toolResult = await tsCheck({ projectRoot });
          } else if (toolName === "run_tests") {
            toolResult = await runTests(projectRoot);
          } else if (toolName === "run_build") {
            toolResult = await runBuild(projectRoot);
          } else if (toolName === "run_lint") {
            toolResult = await runLint(projectRoot);
          } else {
            toolResult = { ok: false, error: `Unknown tool: ${toolName}` };
          }

          toolUsage.push({ toolName, ok: true } as any);

          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolId,
            is_error: false,
            content: [{ type: "text" as const, text: JSON.stringify(toolResult) }],
          });
        } catch (e: any) {
          toolUsage.push({ toolName, ok: false, error: e?.message ?? String(e) } as any);

          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolId,
            is_error: true,
            content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: e?.message ?? String(e) }) }],
          });
        }
      }

      // Tool-resultit takaisin Claudelle
      claudeMessages.push({ role: "user", content: toolResultBlocks });
    }

    const usageSummary: UsageSnapshot = {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens: totalPromptTokens + totalCompletionTokens,
    };

    return {
      output:
        lastText ||
        `[ERROR] Anthropic tool-calling loop exceeded (${maxRounds}). Usage=${JSON.stringify(usageSummary)}`,
      rounds: maxRounds,
      toolUsage,
      usage: usageSummary,
      cost: calculateCostFromUsage(usageSummary, params.modelId),
    };

  }

  // ===========================
  // OpenAI: ennallaan
  // ===========================
  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {

    const response = await openaiClient.chat.completions.create({
      model: modelProfile.deployment,
      messages,
      tools: filteredTools,
      tool_choice: "auto",
      temperature: 0,
    });

    const msg = response.choices?.[0]?.message;

    if (response.usage) {
      totalPromptTokens += response.usage.prompt_tokens ?? 0;
      totalCompletionTokens += response.usage.completion_tokens ?? 0;
    }

    const usageSummary: UsageSnapshot = {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens: totalPromptTokens + totalCompletionTokens,
    };

    if (!msg) {
      return {
        output: "",
        rounds: round,
        toolUsage,
        usage: usageSummary,
        cost: calculateCostFromUsage(usageSummary, params.modelId),
      };
    }

    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
    });

    const toolCalls = (msg.tool_calls ?? []) as ToolCallUnion[];
    if (toolCalls.length === 0) {
      return {
        output: msg.content ?? "",
        rounds: round,
        toolUsage,
        usage: usageSummary,
        cost: calculateCostFromUsage(usageSummary, params.modelId),
      };
    }

    for (const tc of toolCalls) {
      const toolName =
        "function" in tc ? tc.function.name :
          "custom" in tc ? tc.custom.name :
            undefined;

      if (!toolName || !isToolAllowed(mode, toolName)) {
        const err = `Tool not allowed in mode=${mode}: ${toolName}`;
        toolUsage.push({ toolName, ok: false, error: err } as any);
        continue;
      }

      const rawArgs =
        "function" in tc ? tc.function.arguments : JSON.stringify(tc.custom?.input ?? {});
      const parsedArgs = safeJsonParseArgs(rawArgs);

      let toolResult: any;

      /* ===== Tool dispatch ===== */
      try {
        if (toolName === "read_file") {
          const abs = await resolveProjectPath(projectRoot, asNonEmptyString(parsedArgs.path, "path"));
          toolResult = await readFileWithRange(abs, parsedArgs);
        } else if (toolName === "write_file") {
          const abs = await resolveProjectPath(projectRoot, parsedArgs.filePath);
          toolResult = await writeFileRaw(abs, parsedArgs.content);
        } else if (toolName === "apply_patch") {
          const abs = await resolveProjectPath(projectRoot, parsedArgs.filePath);
          toolResult = await applyPatch({ ...parsedArgs, filePath: abs });
        } else if (toolName === "list_files") {
          toolResult = await listFiles({ cwd: projectRoot, patterns: ["**/*"], ignore: DEFAULT_IGNORE_PATTERNS });
        } else if (toolName === "search_in_files") {
          toolResult = await searchInFiles({ cwd: projectRoot, ...parsedArgs });
        } else if (toolName === "find_files_by_name") {
          toolResult = await findFilesByName({ cwd: projectRoot, ...parsedArgs });
        } else if (toolName === "ts_get_outline") {
          const abs = await resolveProjectPath(projectRoot, parsedArgs.filePath);
          toolResult = await getAstOutline(abs, { projectRoot });
        } else if (toolName === "ts_check") {
          toolResult = await tsCheck({ projectRoot });
        } else if (toolName === "run_tests") {
          toolResult = await runTests(projectRoot);
        } else if (toolName === "run_build") {
          toolResult = await runBuild(projectRoot);
        } else if (toolName === "run_lint") {
          toolResult = await runLint(projectRoot);
        } else {
          toolResult = { ok: false, error: `Unknown tool: ${toolName}` };
        }

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult),
        });

        toolUsage.push({ toolName, ok: true } as any);
      } catch (e: any) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ ok: false, error: e.message }),
        });
        toolUsage.push({ toolName, ok: false, error: e.message } as any);
      }
    }
  }

  const usageSummary: UsageSnapshot = {
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
  };

  throw new Error(
    `Tool-calling loop exceeded (${MAX_TOOL_ROUNDS}). Usage=${JSON.stringify(usageSummary)}`
  );
}
