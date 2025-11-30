// src/cli/agentCli.ts
import readline from "readline";
import axios from "axios";

const API_URL = "http://localhost:3000/agent";

type AgentRole = "coder" | "tester" | "critic" | "planner";

function parseRole(value: string | undefined): AgentRole | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === "coder" || v === "tester" || v === "critic" || v === "planner") {
    return v;
  }
  return null;
}

function getRoleFromArgs(): AgentRole {
  const args = process.argv.slice(2);

  const roleFlagIndex = args.findIndex(
    (a) => a === "--role" || a === "-r"
  );

  if (roleFlagIndex !== -1 && args[roleFlagIndex + 1]) {
    const parsed = parseRole(args[roleFlagIndex + 1]);
    if (parsed) {
      return parsed;
    } else {
      console.warn(
        `Tuntematon rooli "${args[roleFlagIndex + 1]}". Käytetään oletusta "coder".`
      );
    }
  }

  return "coder";
}

async function askOnce(question: string, role: AgentRole): Promise<void> {
  try {
    const response = await axios.post(API_URL, {
      message: question,
      role,
    });

    console.log("\n[Agentti]:");
    console.log(response.data.reply);
  } catch (err: any) {
    console.error("Virhe kutsussa:", err.response?.data || err.message);
  }
}

function startCli() {
  let currentRole: AgentRole = getRoleFromArgs();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `[${currentRole}] > `,
  });

  const loop = () => {
    rl.prompt();

    rl.on("line", async (line: string) => {
      const trimmed = line.trim();

      if (!trimmed) {
        rl.prompt();
        return;
      }

      // exit-komento
      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        console.log("Poistutaan.");
        rl.close();
        return;
      }

      // roolin vaihtaminen: /role coder
      if (trimmed.toLowerCase().startsWith("/role")) {
        const [, maybeRole] = trimmed.split(/\s+/, 2);
        const parsed = parseRole(maybeRole);

        if (!maybeRole) {
          console.log(
            `Nykyinen rooli: ${currentRole}. Käytä: /role coder|tester|critic|planner`
          );
        } else if (!parsed) {
          console.log(
            `Tuntematon rooli "${maybeRole}". Sallitut: coder, tester, critic, planner.`
          );
        } else {
          currentRole = parsed;
          rl.setPrompt(`[${currentRole}] > `);
          console.log(`Rooli vaihdettu: ${currentRole}`);
        }

        rl.prompt();
        return;
      }

      // normaali viesti agentille
      await askOnce(trimmed, currentRole);
      rl.prompt();
    });
  };

  console.log(
    `Samuli-agentti CLI. Nykyinen rooli: ${currentRole}. ` +
      `Voit vaihtaa komennolla /role coder|tester|critic|planner. ` +
      `Kirjoita viesti tai 'exit' lopettaaksesi.`
  );

  loop();
}

startCli();
