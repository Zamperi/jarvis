import readline from "readline";
import axios from "axios";
import "dotenv/config";

console.log("CLI CWD:", process.cwd());
console.log("AGENT_API_URL:", process.env.AGENT_API_URL);

type AgentRole = "planner" | "coder" | "tester" | "critic" | "documenter";
const ROLES: AgentRole[] = ["planner", "coder", "tester", "critic", "documenter"];

const API_BASE = process.env.AGENT_API_URL ?? "http://localhost:3000/agent";
const TASK_BASE =
  process.env.AGENT_TASK_URL ?? API_BASE.replace(/\/agent\/?$/i, "/task");

const API_KEY = process.env.AGENT_API_KEY ?? "";

type CostCurrency = "EUR" | "USD";

type CostSummary = {
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalCost?: number;
  currency?: CostCurrency;
};

type TaskPlanResponse = {
  runId: string;
  plan: string;
  planPath?: string;
  cost?: CostSummary;
  ok?: boolean;
  error?: string;
};

type TaskApproveResponse = {
  runId: string;
  ok: boolean;
  cost?: CostSummary;
  error?: string;
};

type TaskExecResponse = {
  runId: string;
  ok: boolean;
  output?: string;
  cost?: CostSummary;
  error?: string;
};

// HUOM: serveri voi palauttaa text/output/reply/message tms.
// Tehdään CLI:stä tolerantti.
type AgentResponseWire = {
  ok?: boolean;
  error?: string;

  // eri mahdolliset kentät
  text?: string;
  output?: string;
  reply?: string;
  message?: string;

  runId?: string;
  cost?: CostSummary;
  usage?: any;
};

type AgentResponse = {
  runId?: string;
  text: string;
  cost?: CostSummary;
  ok?: boolean;
  error?: string;
};

function asRole(v: string): AgentRole | null {
  if (ROLES.includes(v as AgentRole)) return v as AgentRole;
  return null;
}

function formatMoneyEUR(v: number) {
  return `${v.toFixed(4)} €`;
}
function formatMoneyUSD(v: number) {
  return `${v.toFixed(4)} $`;
}
function formatTokens(v: number) {
  return `${Number(v ?? 0)}`;
}

function formatCost(cost?: CostSummary): string {
  if (!cost) return "";
  const currency = cost.currency ?? "USD";
  const totalCost = Number(cost.totalCost ?? 0);
  const money =
    currency === "EUR" ? formatMoneyEUR(totalCost) : formatMoneyUSD(totalCost);
  const tokens = formatTokens(cost.totalTokens ?? 0);
  const promptTokens = formatTokens(cost.promptTokens ?? 0);
  const completionTokens = formatTokens(cost.completionTokens ?? 0);
  return `\n[COST] ${money} | tokens=${tokens} (prompt=${promptTokens}, completion=${completionTokens})\n`;
}

function normalizeAgentResponse(data: AgentResponseWire): AgentResponse {
  const text =
    data.text ??
    data.output ??
    data.reply ??
    data.message ??
    (data.error ? `ERROR: ${data.error}` : "");

  return {
    runId: data.runId,
    text,
    cost: data.cost,
    ok: data.ok,
    error: data.error,
  };
}

// --- CLI state ---
let currentRole: AgentRole = "coder";
let currentProjectRoot: string | null = null;

function buildPrompt(): string {
  const projLabel = currentProjectRoot ?? "-";
  return `[${currentRole}][proj:${projLabel}] > `;
}

function printHelp() {
  console.log(`
Komennot:
  /role <planner|coder|tester|critic|documenter>
  /project <polku>              (esim: /project C:\\codes\\agent)
  /task-plan <task.md>          (esim: /task-plan docs/tasks/feat.md)
  /task-approve <runId>
  /task-exec <runId>
  exit
  /help
`);
}

function headers() {
  return API_KEY ? { "x-api-key": API_KEY } : undefined;
}

async function callAgent(message: string): Promise<AgentResponse> {
  const url = `${API_BASE}/${currentRole}`;
  const payload = {
    message,
    projectRoot: currentProjectRoot,
  };

  const res = await axios.post(url, payload, { headers: headers() });
  return normalizeAgentResponse(res.data as AgentResponseWire);
}

async function taskPlan(taskPath: string): Promise<TaskPlanResponse> {
  const url = `${TASK_BASE}/plan`;
  const payload = {
    role: currentRole,
    taskPath,
    projectRoot: currentProjectRoot,
  };
  const res = await axios.post(url, payload, { headers: headers() });
  return res.data as TaskPlanResponse;
}

async function taskApprove(runId: string): Promise<TaskApproveResponse> {
  const url = `${TASK_BASE}/approve`;
  const payload = {
    role: currentRole,
    runId,
    projectRoot: currentProjectRoot,
  };
  const res = await axios.post(url, payload, { headers: headers() });
  return res.data as TaskApproveResponse;
}

async function taskExec(runId: string): Promise<TaskExecResponse> {
  const url = `${TASK_BASE}/execute`;
  const payload = {
    role: currentRole,
    runId,
    projectRoot: currentProjectRoot,
  };
  const res = await axios.post(url, payload, { headers: headers() });
  return res.data as TaskExecResponse;
}

function isProbablyWindowsAbsPath(p: string) {
  return /^[a-zA-Z]:\\/.test(p);
}

function normalizeProjectPath(p: string) {
  return p.trim();
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(),
  });

  console.log("Jarvis CLI");
  printHelp();

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.setPrompt(buildPrompt());
      rl.prompt();
      return;
    }

    if (trimmed === "exit") {
      rl.close();
      return;
    }

    if (trimmed === "/help" || trimmed === "help" || trimmed === "/commands") {
      printHelp();
      rl.setPrompt(buildPrompt());
      rl.prompt();
      return;
    }

    if (trimmed.startsWith("/role ")) {
      const v = trimmed.slice("/role ".length).trim();
      const candidate = asRole(v);
      if (!candidate) {
        console.log(`Tuntematon rooli: "${v}". Sallitut: ${ROLES.join(", ")}`);
      } else {
        currentRole = candidate;
      }
      rl.setPrompt(buildPrompt());
      rl.prompt();
      return;
    }

    if (trimmed.startsWith("/project ")) {
      const p = trimmed.slice("/project ".length).trim();
      if (!p) {
        console.log("Anna projekti-polku, esim: /project C:\\codes\\agent");
      } else {
        const normalized = normalizeProjectPath(p);
        // sallitaan myös C:/... (sinä käytät sitä)
        if (
          isProbablyWindowsAbsPath(normalized) ||
          /^[a-zA-Z]:\//.test(normalized) ||
          normalized.length > 1
        ) {
          currentProjectRoot = normalized;
        } else {
          console.log("Virheellinen projektipolku.");
        }
      }
      rl.setPrompt(buildPrompt());
      rl.prompt();
      return;
    }

    if (trimmed.startsWith("/task-plan ")) {
      const taskPath = trimmed.slice("/task-plan ".length).trim();
      if (!taskPath) {
        console.log("Anna task.md polku, esim: /task-plan docs/tasks/feature.md");
      } else {
        try {
          const res = await taskPlan(taskPath);

          if (res.error) {
            console.log(`Virhe: ${res.error}`);
            return;
          }

          console.log(`\nRUN ID: ${res.runId}\n`);

          if (res.planPath) {
            console.log(`PLAN FILE: ${res.planPath}`);
            console.log(`Muokkaa tiedostoa ja hyväksy sitten komennolla: /task-approve ${res.runId}\n`);
          } else {
            // fallback jos server ei vielä palauta planPathia
            console.log(res.plan + "\n");
          }

          const costLine = formatCost(res.cost);
          if (costLine) console.log(costLine);

        } catch (err: any) {
          const status = err?.response?.status;
          const msg = err?.response?.data?.error ?? err?.message ?? String(err);

          if (status === 429) {
            // Yritä kaivaa odotusaika viestistä: "Please wait 59 seconds..."
            const m = String(msg).match(/wait\s+(\d+)\s+seconds?/i);
            const seconds = m ? Number(m[1]) : 60;

            console.log(`Virhe /task/plan (429): rate limit. Uusi yritys ${seconds}s kuluttua...`);

            await new Promise((r) => setTimeout(r, seconds * 1000));

            // Retry once
            const res = await taskPlan(taskPath);

            if (res.error) {
              console.log(`Virhe: ${res.error}`);
              return;
            }

            console.log(`\nRUN ID: ${res.runId}\n`);
            if (res.planPath) {
              console.log(`PLAN FILE: ${res.planPath}`);
              console.log(`Muokkaa tiedostoa ja hyväksy sitten komennolla: /task-approve ${res.runId}\n`);
            } else {
              console.log(res.plan + "\n");
            }

            const costLine = formatCost(res.cost);
            if (costLine) console.log(costLine);

            return;
          }

          console.log(
            status
              ? `Virhe /task/plan (${status}): ${msg}`
              : `Virhe /task/plan: ${msg}`
          );
        }

      }
      rl.setPrompt(buildPrompt());
      rl.prompt();
      return;
    }

    if (trimmed.startsWith("/task-approve ")) {
      const runId = trimmed.slice("/task-approve ".length).trim();
      if (!runId) {
        console.log("Anna runId, esim: /task-approve abc123");
      } else {
        try {
          const res = await taskApprove(runId);
          if (res.error) console.log(`Virhe: ${res.error}`);
          console.log(`\nAPPROVED: ${res.ok} (runId=${res.runId})\n`);
          const costLine = formatCost(res.cost);
          if (costLine) console.log(costLine);
        } catch (err: any) {
          const status = err?.response?.status;
          const msg = err?.response?.data?.error ?? err?.message ?? String(err);
          console.log(
            status
              ? `Virhe /task/approve (${status}): ${msg}`
              : `Virhe /task/approve: ${msg}`
          );
        }
      }
      rl.setPrompt(buildPrompt());
      rl.prompt();
      return;
    }

    if (trimmed.startsWith("/task-exec ")) {
      const runId = trimmed.slice("/task-exec ".length).trim();
      if (!runId) {
        console.log("Anna runId, esim: /task-exec abc123");
      } else {
        try {
          const res = await taskExec(runId);
          if (res.error) console.log(`Virhe: ${res.error}`);
          console.log(`\nEXEC OK: ${res.ok} (runId=${res.runId})\n`);
          if (res.output) console.log(res.output + "\n");
          const costLine = formatCost(res.cost);
          if (costLine) console.log(costLine);
        } catch (err: any) {
          const status = err?.response?.status;
          const msg = err?.response?.data?.error ?? err?.message ?? String(err);
          console.log(
            status
              ? `Virhe /task/execute (${status}): ${msg}`
              : `Virhe /task/execute: ${msg}`
          );
        }
      }
      rl.setPrompt(buildPrompt());
      rl.prompt();
      return;
    }

    // --- default: send message to agent ---
    try {
      const res = await callAgent(trimmed);
      if (res.runId) console.log(`\nRUN ID: ${res.runId}\n`);
      console.log(res.text + "\n");
      const costLine = formatCost(res.cost);
      if (costLine) console.log(costLine);
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error ?? err?.message ?? String(err);

      if (status === 404) {
        console.log(
          "404: Endpoint ei löytynyt. Varmista että serveri on käynnissä ja reitit ovat oikein."
        );
      } else {
        console.log(status ? `Virhe (${status}): ${msg}` : `Virhe: ${msg}`);
      }
    } finally {
      rl.setPrompt(buildPrompt());
      rl.prompt();
    }
  });

  rl.on("close", () => {
    console.log("exit");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
