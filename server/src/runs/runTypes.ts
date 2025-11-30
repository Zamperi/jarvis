import { AgentRole } from "../config/projectConfig";

export type RunStatus = "pending" | "running" | "done" | "failed";

export interface Run {
  id: string;
  createdAt: string;
  role: AgentRole;
  status: RunStatus;
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
}
