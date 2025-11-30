// src/agent/agentService.ts
import path from "path";
import { openaiClient, azureConfig } from "../config/azure";
import {
  AgentRole,
  PROJECT_ROOT,
  roleAccessConfig,
} from "../config/projectConfig";
import {
  listFiles,
  readFileWithRange,
  searchInFiles,
  applyPatch,
} from "../tools/fileTools";
import { getAstOutline, tsCheck } from "../tools/tsTools";
import { runTests, runBuild, runLint } from "../tools/execTools";
import { checkActionAgainstPolicy } from "../tools/policyTools";
import { RunStepToolUsage } from "../runs/runTypes";

const BLOCKED_SUBSTRINGS = [
  "/node_modules/",
  "/dist/",
  "/build/",
  "/.next/",
  "/coverage/",
  "/.git/",
  "/migrations/",
];

function isBlockedPath(p: string): boolean {
  const norm = p.replace(/\\/g, "/").toLowerCase();
  return BLOCKED_SUBSTRINGS.some((s) => norm.includes(s));
}

async function callAzureWithRetry(args: {
  model: string;
  messages: any[];
  tools: any[];
  maxRetries?: number;
}): Promise<any> {
  const { model, messages, tools, maxRetries = 2 } = args;

  let attempt = 0;
  let delayMs = 1500;

  while (true) {
    try {
      return await openaiClient.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: "auto",
      });
    } catch (err: any) {
      const status = err?.status;
      const code = err?.code;

      const isRateLimit =
        status === 429 ||
        code === "RateLimitReached" ||
        code === "rate_limit_exceeded";

      if (!isRateLimit || attempt >= maxRetries) {
        throw err;
      }

      attempt += 1;

      // Käytetään joko retry-afteria tai kevyttä backoffia
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

export interface RunAgentParams {
  role: AgentRole;
  systemPrompt: string;
  userMessage: string;
  projectRoot?: string;
}

export interface RunAgentResult {
  reply: string;
  usedTools: RunStepToolUsage[];
}

// Kansioita, joita EI haluta listata/tonkia
const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/.git/**",
  "**/migrations/**",
  "**/prisma/migrations/**",
];


const tools: any[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Lue tiedoston sisältö suhteellisella polulla projektin juuresta (valinnainen rivialue).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          fromLine: { type: "integer", minimum: 1 },
          toLine: { type: "integer", minimum: 1 },
          maxBytes: { type: "integer", minimum: 1 },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "Listaa tiedostot glob-patternien perusteella projektin juuren alta.",
      parameters: {
        type: "object",
        properties: {
          patterns: {
            type: "array",
            items: { type: "string" },
          },
          ignore: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["patterns"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_in_files",
      description:
        "Tekstipohainen haku tiedostoista glob-patternien avulla.",
      parameters: {
        type: "object",
        properties: {
          patterns: {
            type: "array",
            items: { type: "string" },
          },
          query: { type: "string" },
          isRegex: { type: "boolean" },
          ignore: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["patterns", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description:
        "Sovella unified diff -patch yhteen tiedostoon. Käytä vain kun olet varma muutoksesta.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          originalHash: { type: "string" },
          patch: { type: "string" },
          estimatedChangedLines: { type: "integer", minimum: 0 },
          dryRun: { type: "boolean" },
        },
        required: ["filePath", "originalHash", "patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ts_get_outline",
      description:
        "Palauta TypeScript-tiedoston outline: funktiot, luokat, tyypit, interface:t jne.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string" },
        },
        required: ["filePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ts_check",
      description:
        "Aja TypeScript-tyypitystarkistus koko projektille tsconfigin perusteella.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_tests",
      description: "Aja testit (npm test).",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_build",
      description: "Aja build (npm run build).",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_lint",
      description: "Aja lint (npm run lint).",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

interface PolicyConfig {
  projectRoot: string;
  allowedPaths: string[];
  readOnlyPaths: string[];
  maxFilesChanged: number;
  maxTotalChangedLines: number;
}

function buildPolicy(role: AgentRole, projectRoot: string): PolicyConfig {
  const rules = roleAccessConfig[role];

  return {
    projectRoot,
    allowedPaths: rules.allowedPaths,
    // lisätään raskaat kansiot aina read-onlyksi
    readOnlyPaths: [
      ...rules.readOnlyPaths,
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/.git/**",
    ],
    maxFilesChanged: 10,
    maxTotalChangedLines: 500,
  };
}

export async function runAgent(
  params: RunAgentParams
): Promise<RunAgentResult> {
  const { role, systemPrompt, userMessage, projectRoot } = params;

  const root = projectRoot ?? PROJECT_ROOT;

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const usedTools: RunStepToolUsage[] = [];
  const policy = buildPolicy(role, root);

  for (let round = 0; round < 2; round++) {
    const completion = await callAzureWithRetry({
      model: azureConfig.deployment,
      messages,
      tools,
    });

    const choice = completion.choices[0];
    const msg: any = choice.message;
    const toolCalls = msg.tool_calls;

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
        let parsedArgs: any;
        try {
          parsedArgs = toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {};
        } catch {
          parsedArgs = {};
        }

        let toolResult: any = null;

        try {
          if (toolName === "read_file") {
            const abs = path.join(root, parsedArgs.path);

            if (isBlockedPath(abs)) {
              toolResult = {
                ok: false,
                error: "Reading from this directory is blocked by policy (node_modules/dist/migrations/etc).",
              };
            } else {
              toolResult = await readFileWithRange(abs, {
                fromLine: parsedArgs.fromLine,
                toLine: parsedArgs.toLine,
                maxBytes: parsedArgs.maxBytes,
              });
            }
          }
          else if (toolName === "list_files") {
            const rawPatterns = parsedArgs.patterns as string[] | undefined;
            let patterns: string[];

            // jos mallilta ei tule mitään järkevää, käytetään "**/*"
            if (!Array.isArray(rawPatterns) || rawPatterns.length === 0) {
              patterns = ["**/*"];
            } else {
              patterns = rawPatterns;
            }

            const ignorePatterns = [
              ...DEFAULT_IGNORE_PATTERNS,
              ...(parsedArgs.ignore || []),
            ];

            let res = await listFiles({
              cwd: root,
              patterns,
              ignore: ignorePatterns,
            });

            // suojataan tokenkulutusta
            toolResult = Array.isArray(res) ? res.slice(0, 300) : res;
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
          }
          else if (toolName === "apply_patch") {
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
        });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      continue;
    }

    const content = msg.content;
    if (!content) {
      throw new Error("Azure OpenAI ei palauttanut sisältöä.");
    }

    messages.push({
      role: "assistant",
      content,
    });

    return { reply: content as string, usedTools };
  }

  throw new Error("Tool-calling -loopin maksimimäärä (2) ylittyi.");
}
