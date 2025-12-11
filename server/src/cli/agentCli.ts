import readline from "readline";
import axios from "axios";

const API_URL = "http://localhost:3000/agent";

type AgentRole = "planner" | "coder" | "tester" | "critic" | "documenter";

interface TimeBucketSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUSD: number;
  costEUR: number;
}

interface CostSummary {
  byDay: Record<string, TimeBucketSummary>;
  byWeek: Record<string, TimeBucketSummary>;
  byMonth: Record<string, TimeBucketSummary>;
  total: TimeBucketSummary;
}


function parseRole(value: string | undefined): AgentRole | null {
  if (!value) return null;
  const v = value.toLowerCase();
  const allowed: AgentRole[] = ["planner", "coder", "tester", "critic", "documenter"];
  if (allowed.includes(v as AgentRole)) {
    return v as AgentRole;
  }
  return null;
}

// komentoriviltä: --project C:\codes\movieapp
const projectArgIndex = process.argv.indexOf("--project");
const cliProjectRoot =
  projectArgIndex > -1 ? process.argv[projectArgIndex + 1] : undefined;

let currentRole: AgentRole = "coder";
let currentProjectRoot: string | undefined =
  cliProjectRoot || process.env.AGENT_PROJECT_ROOT || undefined;
let currentRunId: string | "-" = "-";

function buildPrompt(): string {
  const projLabel = currentProjectRoot ?? "-";
  return `[${currentRole}][proj:${projLabel}][run:${currentRunId}] > `;
}

function startCli() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(),
  });

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

    if (trimmed.startsWith("/role ")) {
      const parts = trimmed.split(/\s+/);
      const candidate = parseRole(parts[1]);
      if (!candidate) {
        console.log(
          "Tuntematon rooli. Sallitut: planner, coder, tester, critic, documenter"
        );
      } else {
        currentRole = candidate;
        console.log(`Rooli vaihdettu: ${currentRole}`);
      }
      rl.setPrompt(buildPrompt());
      rl.prompt();
      return;
    }

    if (trimmed.startsWith("/project ")) {
      const newRoot = trimmed.slice("/project ".length).trim();
      if (!newRoot) {
        console.log("Anna projektihakemisto, esim: /project C:\\codes\\movieapp");
      } else {
        currentProjectRoot = newRoot;
        console.log(`Projektijuuri asetettu: ${currentProjectRoot}`);
      }
      rl.setPrompt(buildPrompt());
      rl.prompt();
      return;
    }
    if (trimmed === "/costs") {
      try {
        const resp = await axios.get<CostSummary>("http://localhost:3000/costs/summary");
        const summary: CostSummary = resp.data;

        console.log("\nKUSTANNUSYHTEENVETO");
        console.log("===================\n");

        const formatMoney = (n: number) => `${n.toFixed(4)} €`;
        const formatTokens = (n: number) => n.toLocaleString("fi-FI");

        // Päivittäin – näytetään esim. 7 viimeistä
        const dayEntries = Object.entries(summary.byDay || {}) as [
          string,
          TimeBucketSummary
        ][];
        const lastDays = dayEntries.slice(-7);

        console.log("PÄIVITTÄIN (viimeiset 7 päivää):");
        if (lastDays.length === 0) {
          console.log("  ei dataa\n");
        } else {
          for (const [day, agg] of lastDays) {
            console.log(
              `  ${day}: ${formatMoney(agg.costEUR)}  (tokens: ${formatTokens(
                agg.totalTokens
              )})`
            );
          }
          console.log("");
        }

        // Viikoittain – näytetään esim. 6 viimeistä
        const weekEntries = Object.entries(summary.byWeek || {}) as [
          string,
          TimeBucketSummary
        ][];
        const lastWeeks = weekEntries.slice(-6);

        console.log("VIIKOITTAIN (viimeiset 6 viikkoa):");
        if (lastWeeks.length === 0) {
          console.log("  ei dataa\n");
        } else {
          for (const [week, agg] of lastWeeks) {
            console.log(
              `  ${week}: ${formatMoney(agg.costEUR)}  (tokens: ${formatTokens(
                agg.totalTokens
              )})`
            );
          }
          console.log("");
        }

        // Kuukausittain – näytetään kaikki
        const monthEntries = Object.entries(summary.byMonth || {}) as [
          string,
          TimeBucketSummary
        ][];

        console.log("KUUKAUSITTAIN:");
        if (monthEntries.length === 0) {
          console.log("  ei dataa\n");
        } else {
          for (const [month, agg] of monthEntries) {
            console.log(
              `  ${month}: ${formatMoney(agg.costEUR)}  (tokens: ${formatTokens(
                agg.totalTokens
              )})`
            );
          }
          console.log("");
        }

        // Kokonaiskuva
        const total = summary.total;
        console.log("YHTEENSÄ:");
        console.log(
          `  ${formatMoney(total.costEUR)}  (tokens: ${formatTokens(
            total.totalTokens
          )})\n`
        );
      } catch (err: any) {
        console.error("Kustannusten haku epäonnistui:", err?.message ?? err);
      }

      rl.setPrompt(buildPrompt());
      rl.prompt();
      return;
    }


    try {
      const payload: any = {
        message: trimmed,
        role: currentRole,
      };
      if (currentProjectRoot) {
        payload.projectRoot = currentProjectRoot;
      }

      const resp = await axios.post(API_URL, payload);

      const reply = resp.data.reply;
      const runId = resp.data.runId ?? "-";
      currentRunId = runId;

      const usage = resp.data.usage;
      const cost = resp.data.cost;

      console.log(`\n[agent/${currentRole}]: ${reply}\n`);

      if (usage && cost) {
        const pt = usage.promptTokens ?? 0;
        const ct = usage.completionTokens ?? 0;
        const tt = usage.totalTokens ?? pt + ct;
        const usd = cost.usd ?? 0;
        const eur = cost.eur ?? 0;

        console.log(
          `Tokens: ${pt} in, ${ct} out (total ${tt})\n` +
          `Cost (est.): ${eur.toFixed(4)} €  (${usd.toFixed(4)} $)\n`
        );
      }
    } catch (err: any) {
      if (err?.response?.status === 429 && err?.response?.data?.error === "rate_limit") {
        console.error(
          "Azure OpenAI -ratelimit: " + (err.response.data.message ?? "raja ylittyi.")
        );
      } else {
        console.error("Virhe kutsussa:", err?.message ?? err);
      }
    }


    rl.setPrompt(buildPrompt());
    rl.prompt();
  });

  console.log(
    "Samuli-agentti CLI.\n" +
    "- /role planner|coder|tester|critic|documenter → vaihda roolia\n" +
    "- /project C:\\polku\\projektiin → vaihda kohdeprojektia\n" +
    "-/costs → saa kustannus yhteenveto\n" +
    "- 'exit' → poistu\n" +
    "- voit antaa myös --project C:\\polku komentorivillä"
  );

  rl.prompt();
}

startCli();
