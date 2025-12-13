import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import agentRouter from "./routes/agentRoutes";
import taskRouter from "./routes/taskRoutes";

const app = express();
const port = Number(process.env.PORT) || 3000;

// Suojaa suurilta payloadilta
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.send("Samuli Agent backend on käynnissä.");
});

// Optio: jos AGENT_API_KEY on asetettu, vaadi se jokaisessa pyynnössä
const apiKey = process.env.AGENT_API_KEY;
if (apiKey) {
  app.use((req, res, next) => {
    const got = req.header("x-api-key");
    if (!got || got !== apiKey) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    next();
  });
}

// Agent endpointit: /agent/:role
app.use("/agent", agentRouter);

// Task-workflow: /task/plan, /task/approve, /task/execute
app.use("/task", taskRouter);

// Keskitetty virhehandleri (aina JSON)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = Number(err?.status) || 500;
  const message = err?.message || "Internal Server Error";
  res.status(status).json({ ok: false, error: message });
});

app.listen(port, () => {
  console.log(`Server käynnissä http://localhost:${port}`);
});
