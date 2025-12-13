import path from "path";
import fs from "fs/promises";
import { openaiClient, azureConfig } from "../config/azure";
import { PROJECT_ROOT } from "../config/projectConfig";

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
import { RunAgentInternalParams, RunAgentResult } from "./agentTypes";

/**
 * Turvarajat
 */
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

type UsageSnapshot = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

function calculateCostFromUsage(_usage: UsageSnapshot) {
  // agentTypes.ts: RunAgentCost vaatii ainakin usd ja eur
  return { usd: 0, eur: 0 };
}

function isBlockedPath(absPath: string): boolean {
  const p = absPath.split(path.sep).join("/").toLowerCase();

  if (p.includes("/.git/")) return true;
  if (p.includes("/node_modules/")) return true;
  if (p.includes("/dist/")) return true;
  if (p.includes("/build/")) return true;
  if (p.includes("/coverage/")) return true;

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
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("Tool arguments must be a JSON object");
    }
    return parsed;
  } catch {
    throw new Error("Invalid JSON in tool arguments");
  }
}

function asNonEmptyString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`Invalid or missing field: ${field}`);
  }
  return v;
}

function asOptionalPositiveInt(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return undefined;
  return v;
}

function normalizeSlashes(p: string): string {
  return p.split(path.sep).join("/");
}

function toRel(root: string, absOrRel: string): string {
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, absOrRel);
  return normalizeSlashes(path.relative(rootAbs, abs));
}

/**
 * Resolvoi käyttäjän antama suhteellinen polku projektijuuren alle.
 * - estää ..-karkailun
 * - estää absoluuttiset polut
 * - estää NUL-bytet
 * - estää symlink-hyppelyn (realpath-check kun kohde olemassa)
 */
async function resolveProjectPath(root: string, userPath: string): Promise<string> {
  if (userPath.includes("\0")) throw new Error("Invalid path");
  if (path.isAbsolute(userPath)) throw new Error("Absolute paths are not allowed");

  const rootAbs = path.resolve(root);
  const joined = path.resolve(rootAbs, userPath);

  const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  if (joined !== rootAbs && !joined.startsWith(rootWithSep)) {
    throw new Error("Path escapes project root");
  }

  // Symlink-suoja jos kohde on olemassa
  try {
    const real = await fs.realpath(joined);
    const realRoot = await fs.realpath(rootAbs);
    const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;

    if (real !== realRoot && !real.startsWith(realRootWithSep)) {
      throw new Error("Path resolves outside project root (symlink)");
    }
  } catch {
    // ok: tiedostoa ei ehkä ole vielä olemassa
  }

  return joined;
}

type ToolCallUnion =
  | { id: string; function: { name: string; arguments: string } }
  | { id: string; custom: { name: string; input: unknown } };

/**
 * Ajaa agentin tool-calling loopin turvallisesti.
 */
export async function runAgentInternal(
  params: RunAgentInternalParams
): Promise<RunAgentResult> {
  const systemPrompt = params.systemPrompt;
  const userMessage = params.userMessage;

  const projectRoot = path.resolve(params.projectRoot || PROJECT_ROOT);
  const policy = buildDefaultPolicy(projectRoot);

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const toolUsage: RunStepToolUsage[] = [];

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  const model =
    (azureConfig as any)?.deployment ||
    (azureConfig as any)?.model ||
    process.env.AZURE_OPENAI_DEPLOYMENT ||
    process.env.OPENAI_MODEL ||
    "gpt-4.1";

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await openaiClient.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0,
    });

    const msg = response.choices?.[0]?.message;

    const usage = response.usage;
    if (usage) {
      totalPromptTokens += usage.prompt_tokens ?? 0;
      totalCompletionTokens += usage.completion_tokens ?? 0;
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
        cost: calculateCostFromUsage(usageSummary),
      };
    }

    // assistant message talteen
    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
    } as any);

    const toolCalls = (msg.tool_calls ?? []) as unknown as ToolCallUnion[];

    // Ei työkaluja → valmis
    if (toolCalls.length === 0) {
      return {
        output: msg.content ?? "",
        rounds: round,
        toolUsage,
        usage: usageSummary,
        cost: calculateCostFromUsage(usageSummary),
      };
    }

    // Aja toolit järjestyksessä
    for (const tc of toolCalls) {
      const toolCallId = tc.id;

      const toolName =
        "function" in tc ? tc.function.name :
        "custom" in tc ? tc.custom.name :
        undefined;

      if (!toolName) {
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify({ ok: false, error: "Malformed tool call: missing name" }),
        });
        continue;
      }

      const rawArgs =
        "function" in tc
          ? tc.function.arguments
          : JSON.stringify(tc.custom?.input ?? {});

      let parsedArgs: any;
      try {
        parsedArgs = safeJsonParseArgs(rawArgs);
      } catch (e: any) {
        const errMsg = e?.message || "Invalid tool arguments";
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify({ ok: false, error: errMsg }),
        });
        toolUsage.push({ toolName, ok: false, error: errMsg } as any);
        continue;
      }

      let toolResult: any;

      try {
        if (toolName === "read_file") {
          const p = asNonEmptyString(parsedArgs.path, "path");
          const abs = await resolveProjectPath(projectRoot, p);

          if (isBlockedPath(abs)) {
            toolResult = { ok: false, error: "Reading from this path is blocked by policy." };
          } else {
            const pr = checkActionAgainstPolicy({ kind: "readFile", targetPaths: [abs] }, policy);
            if (!pr.allowed) {
              toolResult = { ok: false, error: pr.reason, violations: pr.violations };
            } else {
              toolResult = await readFileWithRange(abs, {
                fromLine: asOptionalPositiveInt(parsedArgs.fromLine),
                toLine: asOptionalPositiveInt(parsedArgs.toLine),
                maxBytes: asOptionalPositiveInt(parsedArgs.maxBytes),
              });

              if (toolResult && typeof toolResult === "object" && "path" in toolResult) {
                toolResult.path = toRel(projectRoot, abs);
              }
            }
          }
        } else if (toolName === "write_file") {
          const filePath = asNonEmptyString(parsedArgs.filePath, "filePath");
          const content = asNonEmptyString(parsedArgs.content, "content");

          if (content.length > MAX_WRITE_CHARS) {
            toolResult = { ok: false, error: "Content too large for write_file" };
          } else {
            const abs = await resolveProjectPath(projectRoot, filePath);

            if (isBlockedPath(abs)) {
              toolResult = { ok: false, error: "Writing to this path is blocked by policy." };
            } else {
              const pr = checkActionAgainstPolicy(
                {
                  kind: "writeFile",
                  targetPaths: [abs],
                  estimatedChangedLines: content.split("\n").length,
                },
                policy
              );

              if (!pr.allowed) {
                toolResult = { ok: false, error: pr.reason, violations: pr.violations };
              } else {
                toolResult = await writeFileRaw(abs, content);
                if (toolResult && typeof toolResult === "object" && "path" in toolResult) {
                  toolResult.path = toRel(projectRoot, abs);
                }
              }
            }
          }
        } else if (toolName === "apply_patch") {
          const filePath = asNonEmptyString(parsedArgs.filePath, "filePath");
          const originalHash = asNonEmptyString(parsedArgs.originalHash, "originalHash");
          const patchText = asNonEmptyString(parsedArgs.patch, "patch");
          const dryRun = !!parsedArgs.dryRun;

          if (patchText.length > MAX_PATCH_CHARS) {
            toolResult = { ok: false, error: "Patch too large for apply_patch" };
          } else {
            const abs = await resolveProjectPath(projectRoot, filePath);

            if (isBlockedPath(abs)) {
              toolResult = { ok: false, error: "Patching this path is blocked by policy." };
            } else {
              const estimated = patchText.split("\n").length;
              const pr = checkActionAgainstPolicy(
                { kind: "applyPatch", targetPaths: [abs], estimatedChangedLines: estimated },
                policy
              );

              if (!pr.allowed) {
                toolResult = { ok: false, error: pr.reason, violations: pr.violations };
              } else {
                toolResult = await applyPatch({
                  filePath: abs,
                  originalHash,
                  patch: patchText,
                  dryRun,
                });

                if (toolResult && typeof toolResult === "object" && "filePath" in toolResult) {
                  toolResult.filePath = toRel(projectRoot, abs);
                }
              }
            }
          }
        } else if (toolName === "list_files") {
          const rawPatterns = parsedArgs.patterns as unknown;
          const patterns = Array.isArray(rawPatterns)
            ? (rawPatterns.filter((x) => typeof x === "string") as string[])
            : [];

          const ignorePatterns = [
            ...DEFAULT_IGNORE_PATTERNS,
            ...(Array.isArray(parsedArgs.ignore) ? parsedArgs.ignore : []),
          ];

          const res = await listFiles({
            cwd: projectRoot,
            patterns: patterns.length > 0 ? patterns : ["**/*"],
            ignore: ignorePatterns,
          });

          toolResult = (Array.isArray(res) ? res : [])
            .map((p) => toRel(projectRoot, p))
            .map(normalizeSlashes)
            .slice(0, 300);
        } else if (toolName === "search_in_files") {
          const query = asNonEmptyString(parsedArgs.query, "query");

          const rawPatterns = parsedArgs.patterns as unknown;
          const patterns = Array.isArray(rawPatterns)
            ? (rawPatterns.filter((x) => typeof x === "string") as string[])
            : ["**/*"];

          const ignorePatterns = [
            ...DEFAULT_IGNORE_PATTERNS,
            ...(Array.isArray(parsedArgs.ignore) ? parsedArgs.ignore : []),
          ];

          toolResult = await searchInFiles({
            cwd: projectRoot,
            patterns,
            query,
            isRegex: !!parsedArgs.isRegex,
            ignore: ignorePatterns,
            maxResultsPerFile:
              typeof parsedArgs.maxResultsPerFile === "number"
                ? parsedArgs.maxResultsPerFile
                : 5,
          });
        } else if (toolName === "find_files_by_name") {
          const query = asNonEmptyString(parsedArgs.query, "query");

          const ignorePatterns = [
            ...DEFAULT_IGNORE_PATTERNS,
            ...(Array.isArray(parsedArgs.ignore) ? parsedArgs.ignore : []),
          ];

          const res = await findFilesByName({
            cwd: projectRoot,
            query,
            patterns: Array.isArray(parsedArgs.patterns) ? parsedArgs.patterns : undefined,
            ignore: ignorePatterns,
            maxResults: typeof parsedArgs.maxResults === "number" ? parsedArgs.maxResults : 50,
          });

          toolResult = res.slice(0, 200).map((p) => toRel(projectRoot, p));
        } else if (toolName === "ts_get_outline") {
          const filePath = asNonEmptyString(parsedArgs.filePath, "filePath");
          const abs = await resolveProjectPath(projectRoot, filePath);

          if (isBlockedPath(abs)) {
            toolResult = { ok: false, error: "This path is blocked by policy." };
          } else {
            const pr = checkActionAgainstPolicy({ kind: "readFile", targetPaths: [abs] }, policy);
            if (!pr.allowed) {
              toolResult = { ok: false, error: pr.reason, violations: pr.violations };
            } else {
              const outline = await getAstOutline(abs, { projectRoot });
              toolResult = { ok: true, filePath: toRel(projectRoot, abs), outline };
            }
          }
        } else if (toolName === "ts_check") {
          toolResult = await tsCheck({ projectRoot });
        } else if (toolName === "run_tests") {
          const pr = checkActionAgainstPolicy({ kind: "runTests" }, policy);
          toolResult = pr.allowed
            ? await runTests(projectRoot)
            : { ok: false, error: pr.reason, violations: pr.violations };
        } else if (toolName === "run_build") {
          const pr = checkActionAgainstPolicy({ kind: "runBuild" }, policy);
          toolResult = pr.allowed
            ? await runBuild(projectRoot)
            : { ok: false, error: pr.reason, violations: pr.violations };
        } else if (toolName === "run_lint") {
          const pr = checkActionAgainstPolicy({ kind: "runLint" }, policy);
          toolResult = pr.allowed
            ? await runLint(projectRoot)
            : { ok: false, error: pr.reason, violations: pr.violations };
        } else {
          toolResult = { ok: false, error: `Unknown tool: ${toolName}` };
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify(toolResult),
        });

        toolUsage.push({
          toolName,
          ok: !(toolResult && toolResult.ok === false),
          error: toolResult?.error,
        } as any);
      } catch (e: any) {
        const errMsg = e?.message || String(e);
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify({ ok: false, error: errMsg }),
        });

        toolUsage.push({ toolName, ok: false, error: errMsg } as any);
      }
    }
  }

  const usageSummary: UsageSnapshot = {
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
  };

  const cost = calculateCostFromUsage(usageSummary);

  throw new Error(
    `Tool-calling -loopin maksimimäärä (${MAX_TOOL_ROUNDS}) ylittyi. Token usage so far: ${JSON.stringify(
      usageSummary
    )}, cost: ${JSON.stringify(cost)}`
  );
}
