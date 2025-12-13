import express, { NextFunction, Request, Response } from "express";
import agentRouter from "./routes/agentRoutes";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

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

// Selkeä prefix → endpointit ovat /agent/:role
app.use("/agent", agentRouter);

// Keskitetty virhehandleri (aina JSON)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = Number(err?.status) || 500;
  const message = err?.message || "Internal Server Error";
  res.status(status).json({ ok: false, error: message });
});

app.listen(port, () => {
  console.log(`Server käynnissä http://localhost:${port}`);
});
