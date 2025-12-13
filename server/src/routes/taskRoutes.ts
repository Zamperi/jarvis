import express from "express";
import path from "path";
import fs from "fs/promises";

import { agentService } from "../agent/agentService";
import { createPlan } from "../agent/taskStore";
import { AgentRole } from "../config/projectConfig";
import { TaskRunState, TaskItemState, TaskStatus } from "../runs/runTypes";

const router = express.Router();

/* ===========================
   Helpers
=========================== */

function nowIso() {
  return new Date().toISOString();
}

function buildPlansDirAbs(projectRootAbs: string) {
  return path.join(projectRootAbs, "docs", "plans");
}

function tasksMdPathAbs(projectRootAbs: string, runId: string) {
  return path.join(buildPlansDirAbs(projectRootAbs), `${runId}.tasks.md`);
}

function tasksJsonPathAbs(projectRootAbs: string, runId: string) {
  return path.join(buildPlansDirAbs(projectRootAbs), `${runId}.tasks.json`);
}

const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableFsError(e: any) {
  const code = e?.code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

async function safeRenameWithRetry(from: string, to: string, attempts = 6) {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e: any) {
      lastErr = e;
      if (!isRetryableFsError(e)) break;
      // Backoff: 25, 50, 100, 200, 400, 800 ms
      await sleep(25 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

async function atomicWriteFile(absPath: string, content: string) {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  const tmp = path.join(
    dir,
    `.${base}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmp, content, "utf-8");

  try {
    await safeRenameWithRetry(tmp, absPath);
    return;
  } catch (e: any) {
    // Windows can throw EPERM on rename due to AV/indexer/file handles.
    // Fallback: copy + unlink (not atomic, but practical).
    if (!isRetryableFsError(e)) {
      // Ensure tmp doesn't pile up
      try {
        await fs.unlink(tmp);
      } catch {}
      throw e;
    }

    // Retry copy a few times as well
    let lastErr: any = e;
    for (let i = 0; i < 6; i++) {
      try {
        await fs.copyFile(tmp, absPath);
        await fs.unlink(tmp);
        return;
      } catch (e2: any) {
        lastErr = e2;
        if (!isRetryableFsError(e2)) break;
        await sleep(25 * Math.pow(2, i));
      }
    }

    try {
      await fs.unlink(tmp);
    } catch {}
    throw lastErr;
  }
}

function resolveProjectRootAbs(bodyProjectRoot?: unknown) {
  if (typeof bodyProjectRoot === "string" && bodyProjectRoot.trim()) {
    return path.resolve(bodyProjectRoot.trim());
  }
  return process.cwd();
}

async function loadTaskRunState(
  projectRootAbs: string,
  runId: string
): Promise<TaskRunState | null> {
  const p = tasksJsonPathAbs(projectRootAbs, runId);
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as TaskRunState;
  } catch {
    return null;
  }
}

async function saveTaskRunState(
  projectRootAbs: string,
  state: TaskRunState
): Promise<void> {
  const p = tasksJsonPathAbs(projectRootAbs, state.runId);
  await atomicWriteFile(p, JSON.stringify(state, null, 2));
}

function parseIsoMs(v?: string) {
  if (!v) return NaN;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : NaN;
}

function isLockStale(
  lock?: { heldBy: string; acquiredAt: string; expiresAt?: string } | null
) {
  if (!lock?.heldBy) return false;
  const now = Date.now();
  const exp = parseIsoMs(lock.expiresAt);
  if (Number.isFinite(exp) && exp <= now) return true;

  const acq = parseIsoMs(lock.acquiredAt);
  if (Number.isFinite(acq) && now - acq > LOCK_TTL_MS) return true;

  // If timestamps are invalid, treat as stale to avoid permanent deadlock.
  if (!Number.isFinite(acq) && !Number.isFinite(exp)) return true;

  return false;
}

async function clearLockIfStale(rootAbs: string, state: TaskRunState) {
  if (!state.lock?.heldBy) return state;
  if (!isLockStale(state.lock)) return state;

  state.lock = undefined;
  // Best-effort save; if it fails, we still return unlocked state so current request can proceed,
  // but next request may still see stale lock if file wasn't updated.
  try {
    await saveTaskRunState(rootAbs, state);
  } catch {
    // swallow
  }
  return state;
}

async function releaseLockBestEffort(rootAbs: string, runId: string, heldBy: string) {
  try {
    const latest = await loadTaskRunState(rootAbs, runId);
    if (!latest?.lock?.heldBy) return;

    // Only release if we own it OR it's stale
    const own = latest.lock.heldBy === heldBy;
    const stale = isLockStale(latest.lock);
    if (!own && !stale) return;

    latest.lock = undefined;
    await saveTaskRunState(rootAbs, latest);
  } catch {
    // best-effort
  }
}

function computeRunStatus(tasks: TaskItemState[]): TaskRunState["status"] {
  if (tasks.some((t) => t.status === "FAILED")) return "failed";
  if (tasks.some((t) => t.status === "IN_PROGRESS")) return "running";
  if (tasks.some((t) => t.status === "PENDING")) return "approved";
  return "done";
}

/* ===========================
   .tasks.md parsing helpers
=========================== */

type TaskItemMd = {
  id: string;
  title: string;
  status: "PENDING" | "DONE" | "SKIPPED";
  files: string[];
  description: string;
  blockStart: number;
  blockEnd: number;
};

function parseTasksMd(md: string): TaskItemMd[] {
  const lines = md.split(/\r?\n/);
  const idxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s*Task/i.test(lines[i].trim())) idxs.push(i);
  }
  if (idxs.length === 0) return [];

  const tasks: TaskItemMd[] = [];
  for (let t = 0; t < idxs.length; t++) {
    const startLine = idxs[t];
    const endLine = t + 1 < idxs.length ? idxs[t + 1] : lines.length;
    const block = lines.slice(startLine, endLine).join("\n");

    const id = (block.match(/^Id:\s*(.+)$/im)?.[1] ?? "").trim();
    const title = (block.match(/^Title:\s*(.+)$/im)?.[1] ?? "").trim();
    const statusRaw = (block.match(/^Status:\s*(.+)$/im)?.[1] ?? "PENDING")
      .trim()
      .toUpperCase();

    const status = (["PENDING", "DONE", "SKIPPED"] as const).includes(
      statusRaw as any
    )
      ? (statusRaw as TaskItemMd["status"])
      : "PENDING";

    const files: string[] = [];
    const filesBlockMatch = block.match(
      /^Files:\s*\n([\s\S]*?)(?:\n\s*\n|\nDescription:|$)/im
    );
    if (filesBlockMatch?.[1]) {
      const fileLines = filesBlockMatch[1]
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const fl of fileLines) {
        const m = fl.match(/^-+\s*(.+)$/);
        if (m?.[1]) files.push(m[1].trim());
      }
    }

    const description = (
      block.match(/^Description:\s*\n([\s\S]*?)$/im)?.[1] ?? ""
    ).trim();

    if (!id || !title) continue;

    tasks.push({
      id,
      title,
      status,
      files,
      description,
      blockStart: startLine,
      blockEnd: endLine,
    });
  }

  return tasks;
}

function toTaskItemState(t: TaskItemMd) {
  return {
    id: t.id,
    title: t.title,
    status: t.status as TaskStatus,
    files: t.files,
    description: t.description,
    attempts: 0,
    logs: [],
  };
}

function renderTaskBlockFromState(t: any): string {
  const filesLines = (t.files ?? []).map((f: string) => `- ${f}`).join("\n");
  return [
    `## Task`,
    `Id: ${t.id}`,
    `Title: ${t.title}`,
    `Status: ${t.status}`,
    `Files:`,
    filesLines || "-",
    "",
    `Description:`,
    t.description || "",
  ].join("\n");
}

function markTaskDoneAndAppendLog(md: string, taskId: string, logText: string): string {
  const lines = md.split(/\r?\n/);
  const tasks = parseTasksMd(md);
  const target = tasks.find((t) => t.id === taskId);
  if (!target) return md;

  for (let i = target.blockStart; i < target.blockEnd; i++) {
    if (/^Status:\s*PENDING\s*$/i.test(lines[i].trim())) {
      lines[i] = "Status: DONE";
      break;
    }
  }

  const insertAt = target.blockEnd;
  const logLines = ["", "### Execution log", "```", (logText ?? "").trim(), "```", ""];
  lines.splice(insertAt, 0, ...logLines);
  return lines.join("\n");
}

/* ===========================
   Routes
=========================== */

/**
 * POST /task/plan
 * Body: { role: AgentRole, taskPath: string, projectRoot?: string }
 */
router.post("/plan", async (req, res, next) => {
  try {
    const { role, taskPath, projectRoot } = req.body ?? {};

    if (!role || typeof role !== "string") {
      return res.status(400).json({ ok: false, error: "role required" });
    }
    if (!taskPath || typeof taskPath !== "string") {
      return res.status(400).json({ ok: false, error: "taskPath required" });
    }

    const userMessage = `TASK FILE PATH: ${taskPath}

Create a TASK BREAKDOWN file (not an implementation plan).
Rules:
- First, read the markdown task file from TASK FILE PATH using tools.
- Output ONLY valid .tasks.md content (no extra prose).
- Split into 3-10 small tasks that can be executed one-by-one.
- Each task MUST list the target files explicitly (or an empty list if unknown).
- Keep each task small: aim for <= 1-2 files changed per task.
- Use this exact format:

# TASK BREAKDOWN
RunId: <placeholder>
Task: <taskPath>
Role: <role>
Status: DRAFT

## Task
Id: T1
Title: <short>
Status: PENDING
Files:
- <relative/path.ts>

Description:
<what to do>`;

    const result = await agentService.run({
      role: role as AgentRole,
      message: userMessage,
      projectRoot,
      mode: "plan",
    });

    const entry = createPlan({
      role: role as AgentRole,
      projectRoot,
      taskPath,
      taskMarkdown: "",
      planText: result.output,
    });

    const effectiveProjectRoot = path.resolve(entry.projectRoot ?? process.cwd());
    const plansDirAbs = buildPlansDirAbs(effectiveProjectRoot);
    await fs.mkdir(plansDirAbs, { recursive: true });

    const mdAbs = tasksMdPathAbs(effectiveProjectRoot, entry.runId);
    const mdRel = path.posix.join("docs", "plans", `${entry.runId}.tasks.md`);

    const mdBody = String(result.output ?? "")
      .replace(/RunId:\s*<placeholder>/i, `RunId: ${entry.runId}`)
      .replace(/Task:\s*<taskPath>/i, `Task: ${entry.taskPath}`)
      .replace(/Role:\s*<role>/i, `Role: ${entry.role}`);

    await fs.writeFile(mdAbs, mdBody, "utf-8");

    const parsed = parseTasksMd(mdBody);
    const state: TaskRunState = {
      runId: entry.runId,
      taskPath: entry.taskPath,
      role: entry.role,
      status: "draft",
      projectRoot: entry.projectRoot,
      createdAt: nowIso(),
      tasks: parsed.map(toTaskItemState),
    };

    await saveTaskRunState(effectiveProjectRoot, state);

    return res.json({
      ok: true,
      runId: entry.runId,
      planPath: mdRel,
      plan: result.output,
      cost: result.cost,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /task/approve
 * Body: { runId: string, projectRoot?: string }
 */
router.post("/approve", async (req, res, next) => {
  try {
    const { runId, projectRoot } = req.body ?? {};
    if (typeof runId !== "string" || !runId.trim()) {
      return res.status(400).json({ ok: false, error: "runId required" });
    }

    const rootAbs = resolveProjectRootAbs(projectRoot);
    const state = await loadTaskRunState(rootAbs, runId);

    if (!state) {
      return res.status(404).json({
        ok: false,
        error: "plan not found (no docs/plans/<runId>.tasks.json under projectRoot)",
        projectRoot: rootAbs,
      });
    }

    if (state.status === "done") return res.json({ ok: true, runId, status: state.status });
    if (state.status === "failed") return res.json({ ok: true, runId, status: state.status });

    state.status = "approved";
    state.approvedAt = nowIso();
    state.lock = undefined;

    await saveTaskRunState(rootAbs, state);

    return res.json({ ok: true, runId, status: state.status });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /task/execute
 * Body: { runId: string, projectRoot?: string }
 *
 * Executes ONLY the next PENDING task based on the JSON state.
 */
router.post("/execute", async (req, res, next) => {
  try {
    const { runId, projectRoot } = req.body ?? {};
    if (typeof runId !== "string" || !runId.trim()) {
      return res.status(400).json({ ok: false, error: "runId required" });
    }

    const rootAbs = resolveProjectRootAbs(projectRoot);

    const mdAbs = tasksMdPathAbs(rootAbs, runId);
    const jsonAbs = tasksJsonPathAbs(rootAbs, runId);

    let state = await loadTaskRunState(rootAbs, runId);
    if (!state) {
      return res.status(404).json({
        ok: false,
        error: "plan not found (no docs/plans/<runId>.tasks.json)",
        projectRoot: rootAbs,
        expected: jsonAbs,
      });
    }

    if (state.status !== "approved" && state.status !== "running") {
      return res.status(409).json({ ok: false, error: `run status is ${state.status}` });
    }

    let lockToken: string | null = null;

    // lock
    state = await clearLockIfStale(rootAbs, state);

    if (state.lock?.heldBy) {
      return res.status(409).json({
        ok: false,
        error: `run is locked (heldBy=${state.lock.heldBy}, acquiredAt=${state.lock.acquiredAt})`,
      });
    }

    lockToken = `lock_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    state.lock = {
      heldBy: lockToken,
      acquiredAt: nowIso(),
      expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
    };

    await saveTaskRunState(rootAbs, state);

    try {
      const nextTask = state.tasks.find((t) => t.status === "PENDING");
      if (!nextTask) {
        state.status = computeRunStatus(state.tasks);
        state.lock = undefined;
        await saveTaskRunState(rootAbs, state);
        return res.json({
          ok: true,
          runId,
          output: "No PENDING tasks left.",
          runStatus: state.status,
        });
      }

      // mark in progress
      nextTask.status = "IN_PROGRESS";
      nextTask.attempts = (nextTask.attempts ?? 0) + 1;
      nextTask.startedAt = nowIso();
      nextTask.lastError = undefined;
      state.status = "running";
      await saveTaskRunState(rootAbs, state);

      const taskBlock = renderTaskBlockFromState(nextTask);

      const userMessage = `YOU ARE EXECUTING EXACTLY ONE TASK.
Do not create new tasks. Do not change scope.

TASK BLOCK (SOURCE OF TRUTH):
${taskBlock}

CONTEXT:
TASK FILE PATH: ${state.taskPath}

Instructions:
- Implement ONLY what is described in TASK BLOCK.
- Touch ONLY files listed under Files: (unless the task explicitly allows otherwise).
- Keep changes minimal and focused.
- At the end, output a short summary of what changed and which files.`;

      try {
        const result = await agentService.run({
          role: state.role as AgentRole,
          message: userMessage,
          projectRoot: state.projectRoot ?? rootAbs,
          mode: "execute",
        });

        // update md best-effort
        try {
          const md = await fs.readFile(mdAbs, "utf-8");
          const updated = markTaskDoneAndAppendLog(md, nextTask.id, result.output ?? "");
          await fs.writeFile(mdAbs, updated, "utf-8");
        } catch {
          // md missing is not fatal
        }

        nextTask.status = "DONE";
        nextTask.completedAt = nowIso();
        nextTask.logs = nextTask.logs ?? [];
        nextTask.logs.push({
          at: nowIso(),
          type: "info",
          message: (result.output ?? "").slice(0, 4000),
        });

        state.status = computeRunStatus(state.tasks);
        state.lock = undefined;
        await saveTaskRunState(rootAbs, state);

        return res.json({
          ok: true,
          runId,
          completedTaskId: nextTask.id,
          completedTaskTitle: nextTask.title,
          output: result.output,
          cost: result.cost,
          runStatus: state.status,
        });
      } catch (e: any) {
        const msg = e?.message ?? String(e);

        nextTask.status = "FAILED";
        nextTask.completedAt = nowIso();
        nextTask.lastError = msg;
        nextTask.logs = nextTask.logs ?? [];
        nextTask.logs.push({ at: nowIso(), type: "error", message: msg.slice(0, 4000) });

        state.status = computeRunStatus(state.tasks);
        state.lock = undefined;
        await saveTaskRunState(rootAbs, state);

        return res.status(500).json({ ok: false, runId, error: msg, failedTaskId: nextTask.id });
      }
    } finally {
      if (lockToken) {
        await releaseLockBestEffort(rootAbs, runId, lockToken);
      }
    }
  } catch (err) {
    next(err);
  }
});

export default router;
