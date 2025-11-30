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

function getRoleFromArgs(): AgentRole {
  const args = process.argv.slice(2);
  const idx = args.findIndex((a) => a === "--role" || a === "-r");
  if (idx !== -1 && args[idx + 1]) {
    const parsed = parseRole(args[idx + 1]);
    if (parsed) return parsed;
    console.warn(`Tuntematon rooli "${args[idx + 1]}". Käytetään oletusta "coder".`);
  }
  return "coder";
}

async function askOnce(
  question: string,
  role: AgentRole,
  runId: string | null
): Promise<{ reply: string; runId: string }> {
  const payload: any = { message: question, role };
  if (runId) {
    payload.runId = runId;
  }

  const response = await axios.post(API_URL, payload);
  const data = response.data as { reply: string; runId: string };
  return { reply: data.reply, runId: data.runId };
}

function startCli() {
  let currentRole: AgentRole = getRoleFromArgs();
  let currentRunId: string | null = null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const updatePrompt = () => {
    const runPart = currentRunId ? currentRunId.slice(0, 8) : "-";
    rl.setPrompt(`[${currentRole}][run:${runPart}] > `);
  };

  updatePrompt();

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();

    if (!trimmed) {
      updatePrompt();
      rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
      console.log("Poistutaan.");
      rl.close();
      return;
    }

    // roolin vaihto: /role documenter
    if (trimmed.toLowerCase().startsWith("/role")) {
      const [, maybeRole] = trimmed.split(/\s+/, 2);
      const parsed = parseRole(maybeRole);

      if (!maybeRole) {
        console.log(
          `Nykyinen rooli: ${currentRole}. Käytä: /role planner|coder|tester|critic|documenter`
        );
      } else if (!parsed) {
        console.log(
          `Tuntematon rooli "${maybeRole}". Sallitut: planner, coder, tester, critic, documenter.`
        );
      } else {
        currentRole = parsed;
        console.log(`Rooli vaihdettu: ${currentRole}`);
      }

      updatePrompt();
      rl.prompt();
      return;
    }

    try {
      const { reply, runId } = await askOnce(trimmed, currentRole, currentRunId);
      currentRunId = runId;

      console.log("\n[Agentti]:");
      console.log(reply);
    } catch (err: any) {
      console.error("Virhe kutsussa:", err.response?.data || err.message);
    }

    updatePrompt();
    rl.prompt();
  });

  console.log(
    "Samuli-agentti CLI.\n" +
    "- käytä /role planner|coder|tester|critic|documenter roolin vaihtoon\n" +
    "- kirjoita 'exit' poistuaksesi\n"
  );

  rl.prompt();
}

startCli();
