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
        const { runId } = req.body ?? {};
        if (typeof runId !== "string" || !runId.trim()) {
            return res.status(400).json({ ok: false, error: "runId required" });
        }

        const entry = approvePlan(runId);
        if (!entry) {
            return res.status(404).json({ ok: false, error: "plan not found" });
        }

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

        // Read the (possibly edited) plan file at execution time
        const effectiveProjectRoot = path.resolve(entry.projectRoot ?? process.cwd());
        const planPathAbs = path.join(
            effectiveProjectRoot,
            "docs",
            "plans",
            `${runId}.plan.md`
        );

        let planText: string;

        try {
            planText = await fs.readFile(planPathAbs, "utf-8");
        } catch (e: any) {
            return res.status(500).json({
                ok: false,
                error: `Plan file not found or unreadable: docs/plans/${runId}.plan.md (root=${effectiveProjectRoot})`,
            });
        }


        const userMessage = `APPROVED PLAN (SOURCE OF TRUTH):
${planText}

TASK FILE PATH: ${entry.taskPath}

Instructions:
- Implement ONLY what is described in the approved plan above.
- If the plan contains extra assumptions not present in the task, follow the plan (it was human-edited).
- At the end, output the required EXECUTE summary format.
`;

        const result = await agentService.run({
            role: entry.role,
            message: userMessage,
            projectRoot: entry.projectRoot,
            mode: "execute",
        });

        return res.json({ ok: true, runId, output: result.output, cost: result.cost });
    } catch (err) {
        next(err);
    }
});

export default router;
