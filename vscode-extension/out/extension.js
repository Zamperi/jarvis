"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const axios_1 = __importDefault(require("axios"));
const path = __importStar(require("path"));
const API_URL = "http://localhost:3000/agent";
// Sama rooli kuin CLI:ssä, voit myöhemmin lisätä valinnan
const DEFAULT_ROLE = "coder";
function activate(context) {
    const output = vscode.window.createOutputChannel("Samuli Agent");
    const disposable = vscode.commands.registerCommand("samuliAgent.ask", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage("Ei aktiivista editoria. Avaa tiedosto ensin.");
            return;
        }
        const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (!workspace) {
            vscode.window.showInformationMessage("Workspacea ei löytynyt. Avaa kansio projektiksi ennen agentin käyttöä.");
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
            const resp = await axios_1.default.post(API_URL, {
                message,
                role: DEFAULT_ROLE,
                projectRoot,
            });
            const reply = resp.data.reply;
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
                output.appendLine(`Tokens: ${pt} in, ${ct} out (total ${tt})`);
                output.appendLine(`Arvioitu kustannus: ${eur.toFixed(4)} € (${usd.toFixed(4)} $)`);
            }
            output.appendLine("\n---\n");
        }
        catch (err) {
            const msg = err?.response?.data?.message ??
                err?.message ??
                String(err);
            vscode.window.showErrorMessage("Samuli-agentin kutsu epäonnistui: " + msg);
            output.appendLine("ERROR: " + msg);
        }
    });
    context.subscriptions.push(disposable);
}
function deactivate() {
    // ei tarvita erityistä siivousta
}
