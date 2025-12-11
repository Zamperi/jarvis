import { AgentRole } from "../config/projectConfig";

export type RunStatus = "pending" | "running" | "done" | "failed";

export interface Run {
  id: string;
  createdAt: string;
  role: AgentRole;
  status: RunStatus;
  projectRoot?: string; // mihin projektiin ajo liittyi
  // Halutessa tänne voi myöhemmin lisätä aggregoidut kustannukset
  // totalPromptTokens?: number;
  // totalCompletionTokens?: number;
  // totalTokens?: number;
  // totalCostUSD?: number;
  // totalCostEUR?: number;
}

export interface RunStepToolUsage {
  name: string;
  args: any;
}

export interface RunStep {
  id: string;
  runId: string;
  index: number;
  inputMessage: string;
  agentRole: AgentRole;
  outputMessage: string;
  usedTools: RunStepToolUsage[];
  createdAt: string;

  // token- ja kustannusmetriikka per step (valinnaisia vanhojen rivien takia)
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUSD?: number;
  costEUR?: number;
}
