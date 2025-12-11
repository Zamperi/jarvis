// src/routes/agentRoutes.ts
import express from "express";
import { runAgent } from "../agent/agentService";
import { AgentRole } from "../config/projectConfig";

const router = express.Router();

/**
 * POST /agent/:role
 * body: { message: string; projectRoot?: string }
 *
 * :role on esim. "coder" tai "documenter"
 */
router.post("/:role", async (req, res, next) => {
  try {
    const roleParam = req.params.role as AgentRole;
    const { message, projectRoot } = req.body as {
      message: string;
      projectRoot?: string;
    };

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const result = await runAgent({
      role: roleParam,
      userMessage: message,
      projectRoot,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
