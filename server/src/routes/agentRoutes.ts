// src/routes/agentRoutes.ts
import express from "express";
import { runAgent } from "../agent/agentService";
import { AgentRole } from "../config/projectConfig";

const router = express.Router();

/**
 * POST /agent/:role
 * body: { message: string; projectRoot?: string; root?: string }
 *
 * :role on esim. "coder" tai "documenter"
 */
router.post("/:role", async (req, res, next) => {
  try {
    const roleParam = req.params.role as AgentRole;

    const { message, projectRoot, root } = req.body as {
      message: string;
      projectRoot?: string;
      root?: string;
    };

    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message is required" });
    }

    const effectiveProjectRoot = projectRoot ?? root;

    const result = await runAgent({
      role: roleParam,
      userMessage: message,
      projectRoot: effectiveProjectRoot,
    });

    return res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
