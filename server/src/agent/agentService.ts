// src/agent/agentService.ts
import {
  RunAgentParams,
  RunAgentResult,
  RunAgentInternalParams,
} from "./agentTypes";
import { runAgentInternal } from "./agentRunner";
import { agentRoleConfig } from "../config/agentRoleConfig";
import { AgentRole } from "../config/projectConfig";

export type { RunAgentParams, RunAgentResult } from "./agentTypes";

/**
 * Normalisoi ulkoa tulevan roolin:
 * - vanha geneerinen "agent" rooli mapataan "coder"-rooliksi
 * - muut arvot menevät sellaisenaan (olettaen että ne ovat validi AgentRole)
 */
function normalizeRole(rawRole: string): AgentRole {
  if (rawRole === "agent") {
    return "coder";
  }
  return rawRole as AgentRole;
}

export async function runAgent(
  params: RunAgentParams
): Promise<RunAgentResult> {
  const { role, userMessage, projectRoot } = params;

  // Takautuva yhteensopivuus vanhoihin kutsuihin, jotka lähettävät "agent"
  const normalizedRole = normalizeRole(role as unknown as string);
  const roleCfg = agentRoleConfig[normalizedRole];

  if (!roleCfg) {
    throw new Error(`Unknown agent role: ${role}`);
  }

  const internalParams: RunAgentInternalParams = {
    role: normalizedRole,
    systemPrompt: roleCfg.systemPrompt,
    userMessage,
    projectRoot,
  };

  return runAgentInternal(internalParams);
}
