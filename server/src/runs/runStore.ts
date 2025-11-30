import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { PROJECT_ROOT, AgentRole } from "../config/projectConfig";
import { Run, RunStatus, RunStep, RunStepToolUsage } from "./runTypes";

const DATA_DIR = path.join(PROJECT_ROOT, "data");
const RUNS_FILE = path.join(DATA_DIR, "runs.ndjson");
const STEPS_FILE = path.join(DATA_DIR, "run_steps.ndjson");

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function newId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function createRun(
  role: AgentRole,
  projectRoot?: string
): Promise<Run> {
  await ensureDataDir();
  const run: Run = {
    id: newId(),
    createdAt: new Date().toISOString(),
    role,
    status: "running",
    projectRoot,
  };

  await fs.appendFile(RUNS_FILE, JSON.stringify(run) + "\n", "utf8");
  return run;
}

export async function updateRunStatus(
  runId: string,
  status: RunStatus
): Promise<void> {
  await ensureDataDir();
  let raw: string;
  try {
    raw = await fs.readFile(RUNS_FILE, "utf8");
  } catch {
    return;
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const updated: Run[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Run;
      if (obj.id === runId) {
        obj.status = status;
      }
      updated.push(obj);
    } catch {
      // rikkinäinen rivi ohitetaan
    }
  }

  const out = updated.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await fs.writeFile(RUNS_FILE, out, "utf8");
}

export async function addRunStep(params: {
  runId: string;
  index: number;
  agentRole: AgentRole;
  inputMessage: string;
  outputMessage: string;
  usedTools: RunStepToolUsage[];
}): Promise<RunStep> {
  await ensureDataDir();
  const step: RunStep = {
    id: newId(),
    runId: params.runId,
    index: params.index,
    inputMessage: params.inputMessage,
    agentRole: params.agentRole,
    outputMessage: params.outputMessage,
    usedTools: params.usedTools,
    createdAt: new Date().toISOString(),
  };

  await fs.appendFile(STEPS_FILE, JSON.stringify(step) + "\n", "utf8");
  return step;
}

export async function getRunSteps(runId: string): Promise<RunStep[]> {
  await ensureDataDir();
  let raw: string;
  try {
    raw = await fs.readFile(STEPS_FILE, "utf8");
  } catch {
    return [];
  }

  const steps: RunStep[] = [];
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

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

  steps.sort((a, b) => a.index - b.index);
  return steps;
}
