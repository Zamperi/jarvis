import readline from "readline";
import axios from "axios";

const API_URL = "http://localhost:3000/agent";

type AgentRole = "planner" | "coder" | "tester" | "critic" | "documenter";

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

      console.log(`\n[agent/${currentRole}]: ${reply}\n`);
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
    "- 'exit' → poistu\n" +
    "- voit antaa myös --project C:\\polku komentorivillä"
  );

  rl.prompt();
}

startCli();
