import express from "express";
import agentRouter from "./routes/agentRoutes";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Samuli Agent backend on käynnissä.");
});

app.use("/agent", agentRouter);

app.listen(port, () => {
  console.log(`Server käynnissä http://localhost:${port}`);
});
