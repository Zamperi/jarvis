import { AgentRole } from "../config/projectConfig";
import { RunStepToolUsage } from "../runs/runTypes";

export type RunMode = "plan" | "execute";

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
  mode?: RunMode; // plan | execute
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
  output: string;
  rounds: number;
  toolUsage: RunStepToolUsage[];
  usage: RunAgentUsage;
  cost: RunAgentCost;
}

export type UsageSnapshot = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};
