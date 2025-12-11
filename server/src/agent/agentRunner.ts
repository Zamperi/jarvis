// src/agent/agentRunner.ts
import path from "path";
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
import { checkActionAgainstPolicy } from "../tools/policyTools";
import { RunStepToolUsage } from "../runs/runTypes";

import {
  DEFAULT_IGNORE_PATTERNS,
  MAX_TOOL_ROUNDS,
  isBlockedPath,
  buildPolicy,
  calculateCostFromUsage,
  PolicyConfig,
} from "./agentConfig";
import {
  RunAgentInternalParams,
  RunAgentResult,
  UsageSnapshot,
} from "./agentTypes";
import { tools } from "./toolsRegistry";
import {
  getProjectInfo,
  readJsonCompact,
  getRunLog,
} from "../tools/projectTools";

async function callAzureWithRetry(args: {
  model: string;
  messages: any[];
  tools: any[];
  maxRetries?: number;
}): Promise<any> {
  const { model, messages, tools, maxRetries = 2 } = args;

  let attempt = 0;
  let delayMs = 1500;

  // yksinkertainen eksponentiaalinen backoff 429-virheille
  // ei pidä loopittaa loputtomiin
  while (true) {
    try {
      return await openaiClient.chat.completions.create({
        model,
        messages,
        tools,
      });
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode;
      const code = err?.code ?? err?.error?.code;

      const isRateLimit =
        status === 429 ||
        code === "RateLimitReached" ||
        code === "rate_limit_exceeded";

      if (!isRateLimit || attempt >= maxRetries) {
        throw err;
      }

      attempt += 1;

      let retryAfterMs = delayMs;
      const ra =
        err?.headers?.get?.("retry-after") ?? err?.headers?.["retry-after"];
      if (ra) {
        const seconds = Number(ra);
        if (!Number.isNaN(seconds) && seconds > 0) {
          retryAfterMs = seconds * 1000;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      delayMs *= 2;
    }
  }
}

export async function runAgentInternal(
  params: RunAgentInternalParams
): Promise<RunAgentResult> {
  const { role, systemPrompt, userMessage, projectRoot } = params;
  const root = projectRoot ?? PROJECT_ROOT;

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const usedTools: RunStepToolUsage[] = [];
  const policy: PolicyConfig = buildPolicy(role, root);

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await callAzureWithRetry({
      model: azureConfig.deployment,
      messages,
      tools,
    });

    const usage = completion.usage;
    if (usage) {
      const p = usage.prompt_tokens ?? 0;
      const c = usage.completion_tokens ?? 0;
      const t = usage.total_tokens ?? p + c;
      totalPromptTokens += p;
      totalCompletionTokens += c;
      totalTokens += t;
    }

    const choice = completion.choices?.[0];
    if (!choice) {
      throw new Error("Azure OpenAI ei palauttanut valintoja.");
    }

    const msg = choice.message;
    const toolCalls = msg.tool_calls;

    // Tool-kutsuja → lisätään assistant-viesti tool_callsin kanssa ja ajetaan työkalut
    if (toolCalls && toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: toolCalls.map((tc: any) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      });

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        let parsedArgs: any = {};
        try {
          parsedArgs = toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {};
        } catch {
          parsedArgs = {};
        }

        let toolResult: any = null;

        try {
          // roolikohtainen tools-check
          if (!policy.allowedTools.includes(toolName)) {
            toolResult = {
              ok: false,
              error: `Tool "${toolName}" is not allowed for this role.`,
            };
          } else if (toolName === "read_file") {
            const abs = path.join(root, parsedArgs.path);

            if (isBlockedPath(abs)) {
              toolResult = {
                ok: false,
                error:
                  "Reading from this directory is blocked by policy (node_modules/dist/migrations/etc).",
              };
            } else {
              toolResult = await readFileWithRange(abs, {
                fromLine: parsedArgs.fromLine,
                toLine: parsedArgs.toLine,
                maxBytes: parsedArgs.maxBytes,
              });
            }
          } else if (toolName === "list_files") {
            const rawPatterns = parsedArgs.patterns as string[] | undefined;
            let patterns: string[] = Array.isArray(rawPatterns)
              ? [...rawPatterns]
              : [];

            const tooGeneric =
              patterns.length === 0 ||
              patterns.some(
                (p) => p === "*" || p === "." || p === "./"
              );

            if (tooGeneric) {
              patterns = ["**/*"];
            }

            const ignorePatterns = [
              ...DEFAULT_IGNORE_PATTERNS,
              ...(parsedArgs.ignore || []),
            ];

            const res = await listFiles({
              cwd: root,
              patterns,
              ignore: ignorePatterns,
            });

            toolResult = Array.isArray(res) ? res.slice(0, 300) : res;
          } else if (toolName === "find_files_by_name") {
            const ignorePatterns = [
              ...DEFAULT_IGNORE_PATTERNS,
              ...(parsedArgs.ignore || []),
            ];

            toolResult = await findFilesByName({
              cwd: root,
              query: parsedArgs.query,
              patterns: parsedArgs.patterns,
              ignore: ignorePatterns,
              maxResults: parsedArgs.maxResults,
            });
          } else if (toolName === "search_in_files") {
            const ignorePatterns = [
              ...DEFAULT_IGNORE_PATTERNS,
              ...(parsedArgs.ignore || []),
            ];

            toolResult = await searchInFiles({
              cwd: root,
              patterns: parsedArgs.patterns,
              query: parsedArgs.query,
              isRegex: parsedArgs.isRegex,
              ignore: ignorePatterns,
            });
          } else if (toolName === "get_project_info") {
            toolResult = await getProjectInfo({ projectRoot: root });
          } else if (toolName === "read_json_compact") {
            const abs = path.join(root, parsedArgs.path);
            toolResult = await readJsonCompact({
              filePath: abs,
              pickKeys: parsedArgs.pickKeys,
              maxStringLength: parsedArgs.maxStringLength,
            });
          } else if (toolName === "get_run_log") {
            const maxChars =
              typeof parsedArgs.maxChars === "number"
                ? parsedArgs.maxChars
                : 4000;
            toolResult = await getRunLog({
              projectRoot: root,
              relativePath: parsedArgs.path,
              maxChars,
            });
          } else if (toolName === "apply_patch") {
            const abs = path.join(root, parsedArgs.filePath);
            const policyResult = checkActionAgainstPolicy(
              {
                kind: "applyPatch",
                targetPaths: [abs],
                estimatedChangedLines: parsedArgs.estimatedChangedLines,
                description: "LLM-driven patch",
              },
              policy
            );
            if (!policyResult.allowed) {
              toolResult = {
                ok: false,
                error: "Policy violation",
                details: policyResult,
              };
            } else {
              const res = await applyPatch({
                filePath: abs,
                originalHash: parsedArgs.originalHash,
                patch: parsedArgs.patch,
                dryRun: parsedArgs.dryRun,
              });
              toolResult = { ok: true, result: res };
            }
          } else if (toolName === "write_file") {
            const abs = path.join(root, parsedArgs.filePath);

            // Estetään vain selvästi kielletyt kansiot (node_modules, dist, jne.)
            if (isBlockedPath(abs)) {
              toolResult = {
                ok: false,
                error:
                  "Writing to this directory is blocked by policy (node_modules/dist/migrations/etc).",
              };
            } else {
              const writtenPath = await writeFileRaw(
                abs,
                parsedArgs.content ?? ""
              );
              toolResult = {
                ok: true,
                result: { path: writtenPath },
              };
            }
          } else if (toolName === "ts_get_outline") {
            const abs = path.join(root, parsedArgs.filePath);
            toolResult = await getAstOutline(abs, {
              projectRoot: root,
            });
          } else if (toolName === "ts_check") {
            toolResult = await tsCheck({ projectRoot: root });
          } else if (toolName === "run_tests") {
            toolResult = await runTests(root);
          } else if (toolName === "run_build") {
            toolResult = await runBuild(root);
          } else if (toolName === "run_lint") {
            toolResult = await runLint(root);
          } else {
            toolResult = { error: `Unknown tool: ${toolName}` };
          }
        } catch (err: any) {
          toolResult = {
            ok: false,
            error: err?.message ?? String(err),
          };
        }

        usedTools.push({
          name: toolName,
          args: parsedArgs,
        } as RunStepToolUsage);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      // mennään seuraavaan kierrokseen, jotta malli näkee tool-tulokset
      continue;
    }

    // Ei tool-kutsuja → tämä on lopullinen vastaus
    const content = msg.content;
    if (!content) {
      throw new Error("Azure OpenAI ei palauttanut sisältöä.");
    }

    messages.push({
      role: "assistant",
      content,
    });

    const usageSummary: UsageSnapshot = {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens,
    };
    const cost = calculateCostFromUsage(usageSummary);

    return {
      reply: content as string,
      usedTools,
      usage: usageSummary,
      cost,
    };
  }

  const usageSummary: UsageSnapshot = {
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    totalTokens,
  };
  const cost = calculateCostFromUsage(usageSummary);

  throw new Error(
    `Tool-calling -loopin maksimimäärä (${MAX_TOOL_ROUNDS}) ylittyi. Token usage so far: ${JSON.stringify(
      usageSummary
    )}, cost: ${JSON.stringify(cost)}`
  );
}
