import readline from "readline";
import axios from "axios";

type AgentRole = "planner" | "coder" | "tester" | "critic" | "documenter";

const ROLES: AgentRole[] = ["planner", "coder", "tester", "critic", "documenter"];

// Serverin base-url. Oletus vastaa sinun server.ts + agentRoutes.ts -mallia: app.use("/agent", router)
const API_BASE = process.env.AGENT_API_URL ?? "http://localhost:3000/agent";

// Optio: jos serveri vaatii x-api-key
const API_KEY = process.env.AGENT_API_KEY;

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

// komentoriviltä: --project C:\codes\movieapp
const projectArgIndex = process.argv.indexOf("--project");
const cliProjectRoot =
  projectArgIndex > -1 ? process.argv[projectArgIndex + 1] : undefined;

let currentRole: AgentRole = "coder";
let currentProjectRoot: string | undefined =
  cliProjectRoot || process.env.AGENT_PROJECT_ROOT || undefined;

function buildPrompt(): string {
  const projLabel = currentProjectRoot ?? "-";
  return `[${currentRole}][proj:${projLabel}] > `;
}

function headers() {
  return API_KEY ? { "x-api-key": API_KEY } : undefined;
}

async function callAgent(message: string) {
  const url = `${API_BASE}/${currentRole}`;

  // HUOM: jos sinun agentRoutes.ts odottaa `root`, käytä tätä:
  const payload: any = { message };
  if (currentProjectRoot) payload.root = currentProjectRoot;

  // Jos olet vaihtanut agentRoutes.ts lukemaan `projectRoot`, vaihda yllä oleva rivi tähän:
  // if (currentProjectRoot) payload.projectRoot = currentProjectRoot;

  const resp = await axios.post(url, payload, { headers: headers() });
  const data = resp.data;

  // Kestää sekä uuden että vanhan response-muodon
  const ok = data?.ok !== false; // jos serveri ei lähetä ok-kenttää, oletetaan ok
  const output: string =
    data?.output ??
    data?.reply ??
    data?.result?.output ??
    "";

  const usage = data?.usage ?? {};
  const cost = data?.cost ?? {};

  const pt = Number(usage.promptTokens ?? 0);
  const ct = Number(usage.completionTokens ?? 0);
  const tt = Number(usage.totalTokens ?? pt + ct);

  const eur = Number(cost.eur ?? 0);
  const usd = Number(cost.usd ?? 0);

  return { ok, output, pt, ct, tt, eur, usd };
}

function startCli() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(),
  });

  console.log("Jarvis CLI");
  console.log("Komennot:");
  console.log("  /role <planner|coder|tester|critic|documenter>");
  console.log('  /project <polku>   (esim: /project C:\\codes\\movieapp)');
  console.log("  exit");
  console.log("");

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

    if (trimmed.startsWith("/role ")) {
      const v = trimmed.slice("/role ".length).trim();
      const candidate = asRole(v);
      if (!candidate) {
        console.log("Tuntematon rooli. Sallitut: planner, coder, tester, critic, documenter");
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

    // Varsinainen agenttikutsu
    try {
      const res = await callAgent(trimmed);

      if (!res.ok) {
        console.log("Agentti palautti virheen.");
      }

      if (res.output) {
        console.log("\n" + res.output + "\n");
      } else {
        console.log("\n(tyhjä vastaus)\n");
      }

      console.log(
        `Tokens: ${formatTokens(res.pt)} in, ${formatTokens(res.ct)} out (total ${formatTokens(res.tt)})\n` +
        `Cost (est.): ${formatMoneyEUR(res.eur)}  (${formatMoneyUSD(res.usd)})\n`
      );
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error ?? err?.message ?? String(err);

      if (status === 404) {
        console.error(
          "404: Endpoint ei löytynyt. Varmista että serverissä on reitti POST /agent/:role ja serveri käynnissä."
        );
      } else if (status === 401) {
        console.error(
          "401: Unauthorized. Jos serveri vaatii avaimen, aseta AGENT_API_KEY ympäristömuuttujaan."
        );
      } else {
        console.error(`Virhe: ${msg}`);
      }
    }

    rl.setPrompt(buildPrompt());
    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

startCli();
