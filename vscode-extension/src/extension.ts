import * as vscode from "vscode";
import axios from "axios";
import * as path from "path";

const API_URL = "http://localhost:3000/agent";

type AgentRole = "planner" | "coder" | "tester" | "critic" | "documenter";

// Sama rooli kuin CLI:ssä, voit myöhemmin lisätä valinnan
const DEFAULT_ROLE: AgentRole = "coder";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Samuli Agent");

  const disposable = vscode.commands.registerCommand(
    "samuliAgent.ask",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage(
          "Ei aktiivista editoria. Avaa tiedosto ensin."
        );
        return;
      }

      const workspace = vscode.workspace.getWorkspaceFolder(
        editor.document.uri
      );
      if (!workspace) {
        vscode.window.showInformationMessage(
          "Workspacea ei löytynyt. Avaa kansio projektiksi ennen agentin käyttöä."
        );
        return;
      }

      const projectRoot = workspace.uri.fsPath;
      const absFile = editor.document.uri.fsPath;
      const relFile = path
        .relative(projectRoot, absFile)
        .replace(/\\/g, "/");

      const question = await vscode.window.showInputBox({
        prompt: `Kysy Samuli-agentilta (tiedosto: ${relFile})`,
        placeHolder: "Esim. 'selitä tämä komponentti' tai 'ehdota refaktorointia'",
      });

      if (!question) {
        return;
      }

      // Varsinainen käyttäjän viesti agentille.
      // Agentti käyttää työkaluja (read_file, list_files, ts_get_outline…) itse.
      const message = `Aktiivinen tiedosto: ${relFile}.\n` +
        `Projektin juurihakemisto: ${projectRoot}.\n\n` +
        `Käyttäjän pyyntö:\n${question}\n\n` +
        `Tutki projektia ja tätä tiedostoa käyttäen omia työkaluja (list_files, read_file, ts_get_outline, ts_check, search_in_files, apply_patch). ` +
        `Selitä mitä teet ja mitä suosittelet. Jos ehdotat muutoksia, kerro ne selkeästi diff-tyyliin.`;

      try {
        output.appendLine(`> ${question}`);
        output.show(true);

        const resp = await axios.post(API_URL, {
          message,
          role: DEFAULT_ROLE,
          projectRoot,
        });

        const reply = resp.data.reply as string;
        const usage = resp.data.usage;
        const cost = resp.data.cost;

        output.appendLine("");
        output.appendLine(reply.trim());
        output.appendLine("");

        if (usage && cost) {
          const pt = usage.promptTokens ?? 0;
          const ct = usage.completionTokens ?? 0;
          const tt = usage.totalTokens ?? pt + ct;
          const eur = cost.eur ?? 0;
          const usd = cost.usd ?? 0;

          output.appendLine(
            `Tokens: ${pt} in, ${ct} out (total ${tt})`
          );
          output.appendLine(
            `Arvioitu kustannus: ${eur.toFixed(4)} € (${usd.toFixed(4)} $)`
          );
        }

        output.appendLine("\n---\n");
      } catch (err: any) {
        const msg =
          err?.response?.data?.message ??
          err?.message ??
          String(err);
        vscode.window.showErrorMessage(
          "Samuli-agentin kutsu epäonnistui: " + msg
        );
        output.appendLine("ERROR: " + msg);
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // ei tarvita erityistä siivousta
}
