import { Router, Request, Response } from "express";
import { runAgent, AgentMessage } from "../agent/agentService";
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

router.post("/", async (req: Request, res: Response) => {
  try {
    const { message, role, runId } = req.body as {
      message?: string;
      role?: AgentRole;
      runId?: string;
    };

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message puuttuu tai ei ole string" });
    }

    const effectiveRole = parseRole(role);
    let currentRunId = runId;

    // luodaan uusi run jos ei annettu
    if (!currentRunId) {
      const run = await createRun(effectiveRole);
      currentRunId = run.id;
    }

    // haetaan aiemmat stepit ja rakennetaan konteksti
    const previousSteps = await getRunSteps(currentRunId);

    const messages: AgentMessage[] = [
      {
        role: "system",
        content:
          "Olet Samulin apuagentti. Vastaat lyhyesti, suoraan ja teknisesti. " +
          "Jos käytät tiedostoja tai työkaluja, kerro se selkeästi luonnollisella kielellä."
      },
    ];

    for (const step of previousSteps) {
      messages.push({ role: "user", content: step.inputMessage });
      messages.push({ role: "assistant", content: step.outputMessage });
    }

    messages.push({ role: "user", content: message });

    const reply = await runAgent(messages);

    // toistaiseksi usedTools tyhjä; liitetään myöhemmin agentServiceen
    await addRunStep({
      runId: currentRunId,
      agentRole: effectiveRole,
      inputMessage: message,
      outputMessage: reply,
      usedTools: [],
    });

    res.json({ reply, runId: currentRunId });
  } catch (err: any) {
    console.error("Agent error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
