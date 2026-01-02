// src/agent/taskStore.ts
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { AgentRole } from "../config/projectConfig";
import type { TaskItemState, TaskRunState } from "../runs/runTypes";

export type PlannedTask = {
  runId: string;
  role: AgentRole;
  projectRoot?: string; // absolute path
  taskPath: string; // as provided by caller (relative or absolute)
  taskMarkdown: string;
  createdAt: string;
  planText: string;
  approved: boolean;
};

export type CreatePlanInput = {
  taskPath: string;
  projectRoot: string; // absolute
  role: AgentRole;
};

const store = new Map<string, PlannedTask>();

function nowIso(): string {
  return new Date().toISOString();
}

function newRunId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * Parse repeatable "## Task" blocks from markdown.
 * If none are found, creates a single fallback task containing the entire markdown.
 */
function parseTasksFromMarkdown(md: string): TaskItemState[] {
  const blocks = md
    .split(/\n(?=##\s+Task\b)/g)
    .map((b) => b.trim())
    .filter(Boolean);

  const tasks: TaskItemState[] = [];

  for (const block of blocks) {
    if (!block.startsWith("## Task")) continue;

    const id =
      (block.match(/\bId:\s*(.+)/)?.[1] ?? "").trim() ||
      crypto.randomBytes(3).toString("hex");
    const title =
      (block.match(/\bTitle:\s*(.+)/)?.[1] ?? "").trim() || "Untitled task";

    const filesSection = block.split(/\nFiles:\s*\n/i)[1] ?? "";
    const filesPart = filesSection.split(/\n\s*Description:\s*\n/i)[0] ?? "";
    const files = filesPart
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).trim())
      .filter(Boolean);

    const description = (block.split(/\n\s*Description:\s*\n/i)[1] ?? "").trim();

    tasks.push({
      id,
      title,
      status: "PENDING",
      files,
      description,
      attempts: 0,
      logs: [],
    });
  }

  if (tasks.length === 0) {
    tasks.push({
      id: "1",
      title: "Task",
      status: "PENDING",
      files: [],
      description: md.trim(),
      attempts: 0,
      logs: [],
    });
  }

  return tasks;
}

export async function createPlan(input: CreatePlanInput): Promise<{
  runId: string;
  md: string;
  json: TaskRunState;
}> {
  const runId = newRunId();
  const createdAt = nowIso();

  const absTaskPath = path.isAbsolute(input.taskPath)
    ? input.taskPath
    : path.resolve(input.projectRoot, input.taskPath);

  const taskMarkdown = await fs.readFile(absTaskPath, "utf8");
  const tasks = parseTasksFromMarkdown(taskMarkdown);

  const json: TaskRunState = {
    runId,
    taskPath: input.taskPath,
    projectRoot: input.projectRoot,
    role: input.role,
    status: "pending",
    tasks,
    createdAt,
    updatedAt: createdAt,
  };

  const md = `# Task Plan
RunId: ${runId}
Role: ${input.role}
ProjectRoot: ${input.projectRoot}
TaskPath: ${input.taskPath}
CreatedAt: ${createdAt}

## Tasks (${tasks.length})
${tasks.map((t) => `- [ ] ${t.id}: ${t.title}`).join("\n")}

---

## Source Task File
${taskMarkdown.trim()}
`;

  store.set(runId, {
    runId,
    role: input.role,
    projectRoot: input.projectRoot,
    taskPath: input.taskPath,
    taskMarkdown,
    createdAt,
    planText: "",
    approved: false,
  });

  return { runId, md, json };
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
