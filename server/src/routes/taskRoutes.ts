// src/routes/taskRoutes.ts
import express from "express";
import path from "path";
import fs from "fs/promises";

import { agentService } from "../agent/agentService";
import { createPlan } from "../agent/taskStore";
import { AgentRole } from "../config/projectConfig";
import { TaskRunState, TaskItemState, TaskStatus } from "../runs/runTypes";
import { tsCheck, getExportedApiOutline, fingerprintExportedApi } from "../tools/tsTools";
import { gitIsRepo, gitStatusPorcelain, gitCheckoutFiles, gitDeleteUntracked } from "../tools/execTools";

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

function resolveProjectRootAbs(input?: string) {
  if (!input) return process.cwd();
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

function computeRunStatus(tasks: TaskItemState[]): TaskRunState["status"] {
  if (tasks.some((t) => t.status === "FAILED")) return "failed";
  if (tasks.every((t) => t.status === "DONE")) return "done";
  if (tasks.some((t) => t.status === "IN_PROGRESS")) return "running";
  return "approved";
}

function renderTaskBlockFromState(task: TaskItemState) {
  return `## Task
Id: ${task.id}
Title: ${task.title}
Status: ${task.status}
Files:
${task.files.map((f) => `- ${f}`).join("\n")}

Description:
${task.description}
`;
}

async function ensurePlansDir(rootAbs: string) {
  await fs.mkdir(buildPlansDirAbs(rootAbs), { recursive: true });
}

async function loadTaskRunState(rootAbs: string, runId: string): Promise<TaskRunState | null> {
  const jsonAbs = tasksJsonPathAbs(rootAbs, runId);
  try {
    const raw = await fs.readFile(jsonAbs, "utf-8");
    return JSON.parse(raw) as TaskRunState;
  } catch {
    return null;
  }
}

async function saveTaskRunState(rootAbs: string, state: TaskRunState) {
  const jsonAbs = tasksJsonPathAbs(rootAbs, state.runId);
  state.updatedAt = nowIso();
  const tmpAbs = `${jsonAbs}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await ensurePlansDir(rootAbs);
  await fs.writeFile(tmpAbs, JSON.stringify(state, null, 2), "utf-8");
  await fs.rename(tmpAbs, jsonAbs);
}

const LOCK_TTL_MS = 10 * 60 * 1000;

async function clearLockIfStale(rootAbs: string, state: TaskRunState): Promise<TaskRunState> {
  if (!state.lock?.expiresAt) return state;
  const exp = Date.parse(state.lock.expiresAt);
  if (!Number.isFinite(exp)) return state;
  if (Date.now() > exp) {
    state.lock = undefined;
    await saveTaskRunState(rootAbs, state);
  }
  return state;
}

function markTaskDoneAndAppendLog(md: string, taskId: string, log: string) {
  const lines = md.split(/\r?\n/);
  let inTask = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "## Task" && lines[i + 1]?.includes(`Id: ${taskId}`)) {
      inTask = true;
    }

    if (inTask && lines[i].startsWith("Status:")) {
      lines[i] = "Status: DONE";
      inTask = false;
      break;
    }
  }

  const safeLog = (log ?? "").slice(0, 2000);
  return `${lines.join("\n")}\n\n---\nLog (${nowIso()}):\n\n${safeLog}\n`;
}

/* ===========================
   Routes
=========================== */

router.post("/plan", async (req, res, next) => {
  try {
    const { taskPath, projectRoot, role } = req.body ?? {};
    if (typeof taskPath !== "string" || !taskPath.trim()) {
      return res.status(400).json({ ok: false, error: "taskPath required" });
    }

    const rootAbs = resolveProjectRootAbs(projectRoot);
    const roleStr = (role as AgentRole) ?? "coder";

    const { runId, md, json } = await createPlan({
      taskPath,
      projectRoot: rootAbs,
      role: roleStr,
    });

    await ensurePlansDir(rootAbs);
    await fs.writeFile(tasksMdPathAbs(rootAbs, runId), md, "utf-8");
    await fs.writeFile(tasksJsonPathAbs(rootAbs, runId), JSON.stringify(json, null, 2), "utf-8");

    return res.json({ ok: true, runId });
  } catch (err) {
    next(err);
  }
});

router.post("/approve", async (req, res, next) => {
  try {
    const { runId, projectRoot } = req.body ?? {};
    if (typeof runId !== "string" || !runId.trim()) {
      return res.status(400).json({ ok: false, error: "runId required" });
    }

    const rootAbs = resolveProjectRootAbs(projectRoot);
    let state = await loadTaskRunState(rootAbs, runId);

    if (!state) {
      return res.status(404).json({ ok: false, error: "plan not found" });
    }

    state.status = "approved";
    await saveTaskRunState(rootAbs, state);

    return res.json({ ok: true, approved: true, runId });
  } catch (err) {
    next(err);
  }
});

router.post("/execute", async (req, res, next) => {
  try {
    const { runId, projectRoot } = req.body ?? {};
    if (typeof runId !== "string" || !runId.trim()) {
      return res.status(400).json({ ok: false, error: "runId required" });
    }

    const rootAbs = resolveProjectRootAbs(projectRoot);

    const mdAbs = tasksMdPathAbs(rootAbs, runId);

    let state = await loadTaskRunState(rootAbs, runId);
    if (!state) {
      return res.status(404).json({
        ok: false,
        error: "plan not found",
      });
    }

    if (state.status !== "approved" && state.status !== "running") {
      return res.status(400).json({
        ok: false,
        error: `run must be approved to execute. current=${state.status}`,
      });
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
          done: true,
          status: state.status,
        });
      }

      nextTask.status = "IN_PROGRESS";
      nextTask.startedAt = nowIso();
      nextTask.attempts = (nextTask.attempts ?? 0) + 1;
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

      // ===== Transactional execution (snapshot → execute → verify → commit|revert) =====
      const allowedRelFiles = (nextTask.files ?? []).map((p) =>
        p.split("\\").join("/")
      );
      const allowedSet = new Set(allowedRelFiles);

      const allowedAbsFiles = allowedRelFiles.map((rel) =>
        path.resolve(rootAbs, rel)
      );

      const allowApiChanges =
        (nextTask.description ?? "").includes("[ALLOW_API_CHANGES]") === true;

      // Fallback snapshot (used when git is unavailable)
      const snapshot = new Map<string, { existed: boolean; content: string }>();
      for (const abs of allowedAbsFiles) {
        try {
          snapshot.set(abs, { existed: true, content: await fs.readFile(abs, "utf8") });
        } catch {
          snapshot.set(abs, { existed: false, content: "" });
        }
      }

      const isRepo = await gitIsRepo(rootAbs);

      // Public API fingerprint for allowed files (guards accidental export changes)
      const apiBefore = await getExportedApiOutline(
        { projectRoot: rootAbs },
        allowedAbsFiles
      );
      const apiBeforeFp = fingerprintExportedApi(apiBefore);

      let result: any;
      try {
        result = await agentService.run({
          role: state.role as AgentRole,
          message: userMessage,
          projectRoot: state.projectRoot ?? rootAbs,
          mode: "execute",
        });
      } catch (err: any) {
        nextTask.status = "FAILED";
        nextTask.completedAt = nowIso();
        nextTask.lastError = err?.message || String(err);
        nextTask.logs = nextTask.logs ?? [];
        nextTask.logs.push({
          at: nowIso(),
          type: "error",
          message: nextTask.lastError ?? "Unknown error",
        });


        state.status = computeRunStatus(state.tasks);
        state.lock = undefined;
        await saveTaskRunState(rootAbs, state);
        return res.status(500).json({ ok: false, error: nextTask.lastError });
      }

      // Identify changed files (git) and enforce "touch only allowed files"
      const changedEntries = isRepo ? await gitStatusPorcelain(rootAbs) : [];
      const changedRelFiles = changedEntries.map((e) => e.path);
      const disallowedChanges = changedRelFiles.filter((p) => !allowedSet.has(p));

      // Verification gates (Definition of Done)
      const tsDiagnostics = await tsCheck({ projectRoot: rootAbs });
      const apiAfter = await getExportedApiOutline(
        { projectRoot: rootAbs },
        allowedAbsFiles
      );
      const apiAfterFp = fingerprintExportedApi(apiAfter);
      const apiChanged = apiAfterFp !== apiBeforeFp;

      const verificationOk =
        disallowedChanges.length === 0 &&
        tsDiagnostics.length === 0 &&
        (allowApiChanges ? true : !apiChanged);

      // If verification fails → revert and mark FAILED
      if (!verificationOk) {
        // revert changed files
        if (isRepo) {
          const tracked = changedEntries
            .filter((e) => !e.isUntracked)
            .map((e) => e.path);
          const untracked = changedEntries
            .filter((e) => e.isUntracked)
            .map((e) => e.path);

          try {
            await gitCheckoutFiles(rootAbs, tracked);
          } catch { }
          try {
            await gitDeleteUntracked(rootAbs, untracked);
          } catch { }
        } else {
          for (const [abs, snap] of snapshot.entries()) {
            try {
              if (!snap.existed) {
                await fs.rm(abs, { force: true });
              } else {
                await fs.mkdir(path.dirname(abs), { recursive: true });
                await fs.writeFile(abs, snap.content, "utf8");
              }
            } catch { }
          }
        }

        const notes: string[] = [];
        if (disallowedChanges.length > 0) {
          notes.push(
            `Disallowed file changes detected: ${disallowedChanges.join(", ")}`
          );
        }
        if (tsDiagnostics.length > 0) {
          notes.push(`TypeScript errors: ${tsDiagnostics.length}`);
        }
        if (!allowApiChanges && apiChanged) {
          notes.push(`Public API exports changed in allowed files (not permitted).`);
        }

        nextTask.status = "FAILED";
        nextTask.completedAt = nowIso();
        nextTask.reverted = true;
        nextTask.changedFiles = changedRelFiles;
        nextTask.verification = {
          ok: false,
          tsErrors: tsDiagnostics.map((d) => ({
            file: d.file,
            line: d.line,
            column: d.column,
            code: d.code,
            message: d.message,
          })),
          notes,
        };

        nextTask.logs = nextTask.logs ?? [];
        nextTask.logs.push({
          at: nowIso(),
          type: "error",
          message: notes.join(" | ").slice(0, 4000),
        });

        state.status = computeRunStatus(state.tasks);
        state.lock = undefined;
        await saveTaskRunState(rootAbs, state);

        return res.status(500).json({
          ok: false,
          error: "Task verification failed; changes were reverted.",
          details: notes,
        });
      }

      // update md best-effort (only after verification passes)
      try {
        const md = await fs.readFile(mdAbs, "utf-8");
        const updated = markTaskDoneAndAppendLog(md, nextTask.id, result.output ?? "");
        await fs.writeFile(mdAbs, updated, "utf-8");
      } catch {
        // md missing is not fatal
      }

      nextTask.status = "DONE";
      nextTask.completedAt = nowIso();
      nextTask.reverted = false;
      nextTask.changedFiles = changedRelFiles;
      nextTask.verification = { ok: true, notes: ["ts_check passed", "scope ok"] };

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
        runId: state.runId,
        taskId: nextTask.id,
        status: nextTask.status,
      });
    } finally {
      // best-effort unlock if we still hold it
      try {
        const fresh = await loadTaskRunState(rootAbs, runId);
        if (fresh?.lock?.heldBy && fresh.lock.heldBy === lockToken) {
          fresh.lock = undefined;
          await saveTaskRunState(rootAbs, fresh);
        }
      } catch { }
    }
  } catch (err) {
    next(err);
  }
});

export default router;
