// src/agent/agentService.ts
import { runAgentInternal } from "./agentRunner";
import { agentRoleConfig } from "../config/agentRoleConfig";
import { AgentRole } from "../config/projectConfig";
import {
  RunAgentResult,
  RunMode,
  RunAgentParams,
  RunAgentInternalParams,
} from "./agentTypes";
import { resolveModel } from "./modelResolver";

export type { RunAgentParams, RunAgentResult } from "./agentTypes";

function normalizeRole(role: AgentRole | string): AgentRole {
  if (role === "agent") return "coder" as AgentRole;
  return role as AgentRole;
}

function systemPromptFor(rolePrompt: string, mode: RunMode): string {
  if (mode === "plan") {
    return `
${rolePrompt}

MODE=PLAN

Rules:
- Do NOT modify files.
- Do NOT run build/tests/lint.
- You MAY read/search/list files to understand the codebase.
- Produce an implementation plan only.

Output format (must):
1) Title
2) Scope (what will change / will not change)
3) Step-by-step plan
4) Files to touch (with reasons)
5) Risks & checks
End with: APPROVAL REQUIRED
`.trim();
  }

  return `
${rolePrompt}

MODE=EXECUTE

Rules:
- Implement only after approval. Follow the approved plan.
- If plan conflicts with codebase, stop and explain mismatch.
- You MAY modify files and run ts_check/build/tests/lint when relevant.

At the end output (must):
- A concise but comprehensive bullet list summary of what was implemented
- List touched files
- List commands run and results (if any)
`.trim();
}

/**
 * Takautuva yhteensopivuus vanhalle API:lle
 */
export async function runAgent(
  params: RunAgentParams
): Promise<RunAgentResult> {
  const normalizedRole = normalizeRole(params.role);
  const roleCfg = agentRoleConfig[normalizedRole];

  if (!roleCfg?.systemPrompt) {
    throw new Error(`Unknown agent role: ${params.role}`);
  }

  return runAgentInternal({
    role: normalizedRole,
    systemPrompt: roleCfg.systemPrompt,
    userMessage: params.userMessage,
    projectRoot: params.projectRoot,
    mode: "execute",
    modelId: resolveModel({
      role: normalizedRole,
      mode: "execute",
    }),
  });
}

/**
 * Uusi API: PLAN / EXECUTE mallivalinnalla
 */
export const agentService = {
  run: async (args: {
    role: AgentRole | string;
    message: string;
    projectRoot?: string;
    mode?: RunMode;
  }): Promise<RunAgentResult> => {
    const normalizedRole = normalizeRole(args.role);
    const roleCfg = agentRoleConfig[normalizedRole];

    if (!roleCfg?.systemPrompt) {
      throw new Error(`Unknown agent role: ${normalizedRole}`);
    }

    const mode: RunMode = args.mode ?? "execute";
    const systemPrompt = systemPromptFor(roleCfg.systemPrompt, mode);

    const modelId = resolveModel({
      role: normalizedRole,
      mode,
    });

    return runAgentInternal({
      role: normalizedRole,
      systemPrompt,
      userMessage: args.message,
      projectRoot: args.projectRoot,
      mode,
      modelId,
    });
  },
};
