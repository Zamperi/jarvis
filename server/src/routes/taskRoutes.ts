import express from "express";
import path from "path";
import fs from "fs/promises";
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

        if (!role || typeof role !== "string") {
            return res.status(400).json({ ok: false, error: "role required" });
        }
        if (!taskPath || typeof taskPath !== "string") {
            return res.status(400).json({ ok: false, error: "taskPath required" });
        }

        const userMessage = `TASK FILE PATH: ${taskPath}

Rules:
- Read ONLY the task file first.
- Do NOT scan the repository unless the task explicitly requires referencing existing code.
- If you must inspect code, limit yourself to: list_files src (once) and read at most 2 files (maxBytes small).
- Output a concise plan.
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

        // Write plan to a file so it can be edited before execution
        const effectiveProjectRoot = path.resolve(entry.projectRoot ?? process.cwd());
        const plansDirAbs = path.join(effectiveProjectRoot, "docs", "plans");
        await fs.mkdir(plansDirAbs, { recursive: true });

        const planPathAbs = path.join(plansDirAbs, `${entry.runId}.plan.md`);
        const planPathRel = path.posix.join("docs", "plans", `${entry.runId}.plan.md`);

        const fileBody = `# PLAN (DRAFT)
RunId: ${entry.runId}
Task: ${entry.taskPath}
Role: ${entry.role}
Status: DRAFT

${entry.planText}
`;
        await fs.writeFile(planPathAbs, fileBody, "utf-8");

        return res.json({
            ok: true,
            runId: entry.runId,
            planPath: planPathRel,
            plan: entry.planText,
            cost: agent.cost,
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
        const { runId, projectRoot } = req.body ?? {};
        if (typeof runId !== "string" || !runId.trim()) {
            return res.status(400).json({ ok: false, error: "runId required" });
        }

        const effectiveProjectRoot = path.resolve(projectRoot ?? process.cwd());
        const planPathAbs = path.join(
            effectiveProjectRoot,
            "docs",
            "plans",
            `${runId}.plan.md`
        );

        let planText: string;
        try {
            planText = await fs.readFile(planPathAbs, "utf-8");
        } catch {
            return res.status(404).json({ ok: false, error: "plan file not found" });
        }

        // Päivitä Status: DRAFT -> Status: APPROVED
        const updated = planText.replace(
            /^Status:\s*DRAFT\s*$/m,
            `Status: APPROVED`
        );

        if (updated === planText) {
            // jos Status-riviä ei löydy, lisätään varovasti
            planText =
                planText.replace(
                    /^Role:\s*(.*)\s*$/m,
                    (m) => `${m}\nStatus: APPROVED`
                );
        } else {
            planText = updated;
        }

        await fs.writeFile(planPathAbs, planText, "utf-8");

        // (Optional) pidä vanha in-memory approve edelleen jos haluat:
        // approvePlan(runId);

        return res.json({ ok: true, runId });
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
    const { runId, projectRoot } = req.body ?? {};
    if (typeof runId !== "string" || !runId.trim()) {
      return res.status(400).json({ ok: false, error: "runId required" });
    }

    const effectiveProjectRoot = path.resolve(projectRoot ?? process.cwd());
    const planPathAbs = path.join(
      effectiveProjectRoot,
      "docs",
      "plans",
      `${runId}.plan.md`
    );

    let planText: string;
    try {
      planText = await fs.readFile(planPathAbs, "utf-8");
    } catch {
      return res.status(404).json({ ok: false, error: "plan file not found" });
    }

    // Vaadi hyväksyntä tiedostosta
    if (!/^Status:\s*APPROVED\s*$/m.test(planText)) {
      return res.status(409).json({ ok: false, error: "plan not approved" });
    }

    // Parsitaan metadata headerista
    const roleMatch = planText.match(/^Role:\s*(.+)\s*$/m);
    const taskMatch = planText.match(/^Task:\s*(.+)\s*$/m);

    const role = roleMatch?.[1]?.trim();
    const taskPath = taskMatch?.[1]?.trim();

    if (!role) {
      return res.status(500).json({ ok: false, error: "Role missing from plan file" });
    }
    if (!taskPath) {
      return res.status(500).json({ ok: false, error: "Task missing from plan file" });
    }

    const userMessage = `APPROVED PLAN (SOURCE OF TRUTH):
${planText}

TASK FILE PATH: ${taskPath}

Hard rules:
- This plan is already approved. Do NOT ask for confirmation. Do NOT ask questions.
- Begin implementation immediately.
- Use tools as needed.
- Implement ONLY what is described in the approved plan above.
- If the plan contains the phrase "APPROVAL REQUIRED", ignore it (approval already happened via /task-approve).
- At the end, output the required EXECUTE summary format.
`;

    const result = await agentService.run({
      role: role as AgentRole,
      message: userMessage,
      projectRoot: effectiveProjectRoot,
      mode: "execute",
    });

    return res.json({ ok: true, runId, output: result.output, cost: result.cost });
  } catch (err) {
    next(err);
  }
});


export default router;
