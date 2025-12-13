import { AgentRole } from "../config/projectConfig";

export type RunStatus = "pending" | "running" | "done" | "failed";

/* ===========================
   Task-run state model
   (explicit, machine-readable)
=========================== */

export type TaskRunStatus =
  | "draft" // planned, editable
  | "approved" // user approved
  | "running" // currently executing tasks
  | "done" // all tasks completed (or skipped)
  | "failed"; // at least one task failed (manual intervention)

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "FAILED";

export interface TaskStepLog {
  at: string; // ISO timestamp
  type: "info" | "error";
  message: string;
}

export interface TaskItemState {
  id: string;
  title: string;
  status: TaskStatus;
  files: string[]; // relative to projectRoot
  description: string;

  // execution bookkeeping
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  logs?: TaskStepLog[];
}

export interface TaskRunState {
  runId: string;
  taskPath: string; // original task.md path
  role: AgentRole;
  status: TaskRunStatus;
  projectRoot?: string;
  createdAt: string;
  approvedAt?: string;

  // simple single-worker lock for /task/execute
  lock?: {
    heldBy: string; // random token
    acquiredAt: string;
    expiresAt?: string;
  };

  tasks: TaskItemState[];
}

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
