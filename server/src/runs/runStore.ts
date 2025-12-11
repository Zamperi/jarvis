import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { PROJECT_ROOT, AgentRole } from "../config/projectConfig";
import { Run, RunStep, RunStepToolUsage, RunStatus } from "./runTypes";

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

  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUSD?: number;
  costEUR?: number;
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
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    totalTokens: params.totalTokens,
    costUSD: params.costUSD,
    costEUR: params.costEUR,
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

//Cost monitoring
// ---- KUSTANNUSYHTEENVETO ----

export interface TimeBucketSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUSD: number;
  costEUR: number;
}

export interface CostSummary {
  byDay: Record<string, TimeBucketSummary>;
  byWeek: Record<string, TimeBucketSummary>;
  byMonth: Record<string, TimeBucketSummary>;
  total: TimeBucketSummary;
}

function emptySummary(): TimeBucketSummary {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUSD: 0,
    costEUR: 0,
  };
}

function addStepToSummary(
  bucket: TimeBucketSummary,
  step: RunStep
): void {
  const pt = step.promptTokens ?? 0;
  const ct = step.completionTokens ?? 0;
  const tt = step.totalTokens ?? pt + ct;
  const usd = step.costUSD ?? 0;
  const eur = step.costEUR ?? 0;

  bucket.promptTokens += pt;
  bucket.completionTokens += ct;
  bucket.totalTokens += tt;
  bucket.costUSD += usd;
  bucket.costEUR += eur;
}

// ISO-viikon avain muodossa YYYY-Wxx
function getISOWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // 1..7, missä 1=maanantai
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // torstai
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const diffDays =
    Math.floor((d.getTime() - yearStart.getTime()) / 86400000) + 1;
  const weekNo = Math.ceil(diffDays / 7);
  const year = d.getUTCFullYear();
  return `${year}-W${weekNo.toString().padStart(2, "0")}`;
}

export async function getCostSummary(): Promise<CostSummary> {
  await ensureDataDir();

  let raw: string;
  try {
    raw = await fs.readFile(STEPS_FILE, "utf8");
  } catch {
    // ei vielä yhtään steppiä
    const total = emptySummary();
    return {
      byDay: {},
      byWeek: {},
      byMonth: {},
      total,
    };
  }

  const byDay: Record<string, TimeBucketSummary> = {};
  const byWeek: Record<string, TimeBucketSummary> = {};
  const byMonth: Record<string, TimeBucketSummary> = {};
  const total = emptySummary();

  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

  for (const line of lines) {
    let step: RunStep;
    try {
      step = JSON.parse(line) as RunStep;
    } catch {
      continue;
    }

    if (!step.createdAt) continue;
    const dt = new Date(step.createdAt);
    if (Number.isNaN(dt.getTime())) continue;

    const dayKey = step.createdAt.slice(0, 10); // YYYY-MM-DD
    const monthKey = step.createdAt.slice(0, 7); // YYYY-MM
    const weekKey = getISOWeekKey(dt);

    if (!byDay[dayKey]) byDay[dayKey] = emptySummary();
    if (!byWeek[weekKey]) byWeek[weekKey] = emptySummary();
    if (!byMonth[monthKey]) byMonth[monthKey] = emptySummary();

    addStepToSummary(byDay[dayKey], step);
    addStepToSummary(byWeek[weekKey], step);
    addStepToSummary(byMonth[monthKey], step);
    addStepToSummary(total, step);
  }

  return { byDay, byWeek, byMonth, total };
}
