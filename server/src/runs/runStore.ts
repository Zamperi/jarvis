import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { PROJECT_ROOT, AgentRole } from "../config/projectConfig";
import { Run, RunStep, RunStepToolUsage } from "./runTypes";

const DATA_DIR = path.join(PROJECT_ROOT, "data");
const RUNS_FILE = path.join(DATA_DIR, "runs.ndjson");
const STEPS_FILE = path.join(DATA_DIR, "run_steps.ndjson");

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // tiedostojen ei ole pakko olla olemassa etukäteen, appendFile luo ne tarvittaessa
}

function newId() {
  return crypto.randomUUID();
}

export async function createRun(role: AgentRole): Promise<Run> {
  await ensureDataFiles();
  const run: Run = {
    id: newId(),
    createdAt: new Date().toISOString(),
    role,
    status: "running",
  };

  const line = JSON.stringify(run) + "\n";
  await fs.appendFile(RUNS_FILE, line, { encoding: "utf8", flag: "a" });

  return run;
}

export async function addRunStep(params: {
  runId: string;
  agentRole: AgentRole;
  inputMessage: string;
  outputMessage: string;
  usedTools: RunStepToolUsage[];
}): Promise<RunStep> {
  await ensureDataFiles();

  const existing = await getRunSteps(params.runId);
  const step: RunStep = {
    id: newId(),
    runId: params.runId,
    index: existing.length,
    inputMessage: params.inputMessage,
    agentRole: params.agentRole,
    outputMessage: params.outputMessage,
    usedTools: params.usedTools,
    createdAt: new Date().toISOString(),
  };

  const line = JSON.stringify(step) + "\n";
  await fs.appendFile(STEPS_FILE, line, { encoding: "utf8", flag: "a" });

  return step;
}

export async function getRunSteps(runId: string): Promise<RunStep[]> {
  await ensureDataFiles();

  let content: string;
  try {
    content = await fs.readFile(STEPS_FILE, "utf8");
  } catch {
    return [];
  }

  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  const steps: RunStep[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as RunStep;
      if (obj.runId === runId) {
        steps.push(obj);
      }
    } catch {
      // rikkinäiset rivit ohitetaan
    }
  }

  // varmistetaan järjestys
  steps.sort((a, b) => a.index - b.index);
  return steps;
}
