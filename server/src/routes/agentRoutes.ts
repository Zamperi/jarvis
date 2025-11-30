import { Router, Request, Response } from "express";
import { runAgent, AgentMessage } from "../agent/agentService";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  try {
    const { message } = req.body as { message?: string };

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message puuttuu tai ei ole string" });
    }

    const messages: AgentMessage[] = [
      {
        role: "system",
        content:
          "Olet Samulin henkilökohtainen dev-agentti. Vastaat lyhyesti, teknisesti ja suoraan. " +
          "Sinulla on työkalut read_file ja write_file projektin tiedostojen lukemiseen ja kirjoittamiseen. " +
          "Käytä read_file-työkalua aina kun tarvitset olemassa olevan tiedoston sisältöä. " +
          "Käytä write_file-työkalua vain, kun käyttäjä pyytää selkeästi tiedoston luontia tai muuttamista. " +
          "Jos et tiedä, sano 'en tiedä'."
      },
      {
        role: "user",
        content: message
      }
    ];

    const reply = await runAgent(messages);

    res.json({ reply });
  } catch (err: any) {
    console.error("Agent error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
