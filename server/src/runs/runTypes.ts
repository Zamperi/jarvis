import { AgentRole } from "../config/projectConfig";

/**
 * Generic run tracking (used elsewhere in the project).
 */
export type RunStatus = "pending" | "running" | "done" | "failed";

export interface RunStepToolUsage {
  toolName: string;
  args?: unknown;
  ok?: boolean;
  summary?: string;
}

export interface RunStep {
  runId: string;
  index: number;
  inputMessage: string;
  agentRole: AgentRole;
  outputMessage: string;
  usedTools: RunStepToolUsage[];
  createdAt: string;

  // optional metrics
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUSD?: number;
  costEUR?: number;
}

export interface Run {
  id: string;
  createdAt: string;
  role: AgentRole;
  status: RunStatus;
  projectRoot?: string;
}

/**
 * Task orchestration state (used by taskRoutes.ts).
 */
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "FAILED";

export interface TaskLogEntry {
  at: string;
  type: "info" | "warn" | "error";
  message: string;
}

export interface TsErrorItem {
  file?: string;
  line?: number;
  column?: number;
  code: number;
  message: string;
}

export interface TaskVerification {
  ok: boolean;
  notes?: string[];
  tsErrors?: TsErrorItem[];
}

export interface TaskItemState {
  id: string;
  title: string;
  status: TaskStatus;

  files: string[];
  description: string;

  attempts?: number;
  startedAt?: string;
  completedAt?: string;

  lastError?: string;
  logs?: TaskLogEntry[];

  changedFiles?: string[];
  verification?: TaskVerification;

  reverted?: boolean;
}

export type TaskRunStatus = "pending" | "approved" | "running" | "done" | "failed";

export interface TaskRunLock {
  heldBy: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface TaskRunState {
  runId: string;
  taskPath: string;
  projectRoot: string; // absolute path
  role: AgentRole;
  status: TaskRunStatus;
  tasks: TaskItemState[];
  createdAt: string;
  updatedAt: string;
  lock?: TaskRunLock;
}
