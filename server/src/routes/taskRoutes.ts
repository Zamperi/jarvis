import express from "express";
import { agentService } from "../agent/agentService";
import { createPlan, getPlan, approvePlan } from "../agent/taskStore";
import { AgentRole } from "../config/projectConfig";

const router = express.Router();

/**
 * POST /task/plan
 * Body: { role: AgentRole, taskPath: string, projectRoot?: string }
 *
 * Agent reads the markdown task file via tools and returns a plan.
 * Plan is stored and returns runId.
 */
router.post("/plan", async (req, res, next) => {
  try {
    const { role, taskPath, projectRoot } = req.body ?? {};

    if (typeof role !== "string") {
      return res.status(400).json({ ok: false, error: "role required" });
    }
    if (typeof taskPath !== "string" || !taskPath.trim()) {
      return res.status(400).json({ ok: false, error: "taskPath required" });
    }

    const userMessage = `TASK FILE PATH: ${taskPath}

Instructions:
- Read the markdown task file from TASK FILE PATH using tools.
- Produce an implementation plan in the required PLAN format.
`;

    const agent = await agentService.run({
      role: role as AgentRole,
      message: userMessage,
      projectRoot,
      mode: "plan",
    });

    const entry = createPlan({
      role: role as AgentRole,
      projectRoot,
      taskPath,
      taskMarkdown: "", // agent lukee md:n itse; jos haluat tallentaa sisällön, tee server-side read myöhemmin
      planText: agent.output,
    });

    return res.json({
      ok: true,
      runId: entry.runId,
      plan: entry.planText,
      agent,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /task/approve
 * Body: { runId: string }
 */
router.post("/approve", async (req, res, next) => {
  try {
    const { runId } = req.body ?? {};
    if (typeof runId !== "string" || !runId.trim()) {
      return res.status(400).json({ ok: false, error: "runId required" });
    }

    const entry = approvePlan(runId);
    if (!entry) {
      return res.status(404).json({ ok: false, error: "plan not found" });
    }

    return res.json({ ok: true, runId, approved: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /task/execute
 * Body: { runId: string }
 */
router.post("/execute", async (req, res, next) => {
  try {
    const { runId } = req.body ?? {};
    if (typeof runId !== "string" || !runId.trim()) {
      return res.status(400).json({ ok: false, error: "runId required" });
    }

    const entry = getPlan(runId);
    if (!entry) {
      return res.status(404).json({ ok: false, error: "plan not found" });
    }
    if (!entry.approved) {
      return res.status(409).json({ ok: false, error: "plan not approved" });
    }

    const userMessage = `APPROVED PLAN:
${entry.planText}

TASK FILE PATH: ${entry.taskPath}

Instructions:
- Re-read the task markdown from TASK FILE PATH (so you have full requirements).
- Implement the approved plan.
- At the end, output the required EXECUTE summary format.
`;

    const result = await agentService.run({
      role: entry.role,
      message: userMessage,
      projectRoot: entry.projectRoot,
      mode: "execute",
    });

    return res.json({ ok: true, runId, result });
  } catch (err) {
    next(err);
  }
});

export default router;
