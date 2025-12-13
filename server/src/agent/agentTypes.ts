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
  // LLM:n lopullinen vastaus
  output: string;

  // Kuinka monta kierrosta agent looppi teki (hyödyllinen diagnostiikassa)
  rounds: number;

  // Ajetut työkalut (järjestyksessä)
  toolUsage: RunStepToolUsage[];

  // Token usage
  usage: RunAgentUsage;

  // Kustannusarvio
  cost: RunAgentCost;
}
