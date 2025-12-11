// src/agent/agentTypes.ts
import { AgentRole } from "../config/projectConfig";
import { RunStepToolUsage } from "../runs/runTypes";

export interface RunAgentParams {
  role: AgentRole;
  userMessage: string;
  projectRoot?: string;
}

export interface RunAgentInternalParams {
  role: AgentRole;
  systemPrompt: string;
  userMessage: string;
  projectRoot?: string;
}

export interface RunAgentUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface RunAgentCost {
  usd: number;
  eur: number;
}

export interface RunAgentResult {
  reply: string;
  usedTools: RunStepToolUsage[];
  usage: RunAgentUsage;
  cost: RunAgentCost;
}

export interface UsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
