import crypto from "crypto";
import { AgentRole } from "../config/projectConfig";

export type PlannedTask = {
  runId: string;
  role: AgentRole;
  projectRoot?: string;
  taskPath: string;
  taskMarkdown: string;
  createdAt: string;
  planText: string;
  approved: boolean;
};

const store = new Map<string, PlannedTask>();

export function createPlan(
  input: Omit<PlannedTask, "runId" | "createdAt" | "approved">
): PlannedTask {
  const runId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const entry: PlannedTask = { ...input, runId, createdAt, approved: false };
  store.set(runId, entry);
  return entry;
}

export function getPlan(runId: string): PlannedTask | undefined {
  return store.get(runId);
}

export function approvePlan(runId: string): PlannedTask | null {
  const entry = store.get(runId);
  if (!entry) return null;
  entry.approved = true;
  store.set(runId, entry);
  return entry;
}
