import { Router, Request, Response } from "express";
import { runAgent } from "../agent/agentService";
import { AgentRole } from "../config/projectConfig";
import { createRun, addRunStep, getRunSteps } from "../runs/runStore";

const router = Router();

function parseRole(raw: unknown): AgentRole {
  const v = String(raw || "").toLowerCase();
  const allowed: AgentRole[] = ["planner", "coder", "tester", "critic", "documenter"];
  if (allowed.includes(v as AgentRole)) {
    return v as AgentRole;
  }
  return "coder";
}

router.post("/agent", async (req: Request, res: Response) => {
  try {
    const { message, role, projectRoot } = req.body ?? {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message puuttuu" });
    }

    const effectiveRole = parseRole(role);
    const effectiveProjectRoot =
      typeof projectRoot === "string" && projectRoot.trim().length > 0
        ? projectRoot.trim()
        : undefined;

    const systemPrompt = `Olet Samulin agenttialustan rooli "${effectiveRole}".
Sinulla on käytössäsi työkaluja koodin tutkimiseen, analysointiin ja refaktorointiin
kohdeprojektissa. Keskity aina lähdekoodikansioihin (esim. src, app, lib) ja
vältä node_modules-, dist-, build-, .next-, coverage- ja .git-kansioita.
Tee pieniä, hyvin perusteltuja muutoksia ja selitä aina, mitä teet.`;

    const run = await createRun(effectiveRole, effectiveProjectRoot);

    const { reply, usedTools } = await runAgent({
      role: effectiveRole,
      systemPrompt,
      userMessage: message,
      projectRoot: effectiveProjectRoot,
    });

    await addRunStep({
      runId: run.id,
      index: 0,
      agentRole: effectiveRole,
      inputMessage: message,
      outputMessage: reply,
      usedTools,
    });

    res.json({ reply, runId: run.id });
  } catch (err: any) {
    console.error("Agent error:", err);

    const status = err?.status;
    const code = err?.code;

    const isRateLimit =
      status === 429 || code === "RateLimitReached" || code === "rate_limit_exceeded";

    if (isRateLimit) {
      const retryAfter = err?.headers?.get?.("retry-after") ?? err?.headers?.["retry-after"];
      return res.status(429).json({
        error: "rate_limit",
        message:
          "Azure OpenAI -palvelun token-raja ylittyi tälle mallille. Odota hetki ja yritä uudelleen.",
        retryAfter,
      });
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

// pieni debug-endpoint, ei pakollinen mutta hyödyllinen
router.get("/runs/:runId/steps", async (req: Request, res: Response) => {
  try {
    const steps = await getRunSteps(req.params.runId);
    res.json({ steps });
  } catch (err: any) {
    console.error("getRunSteps error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
