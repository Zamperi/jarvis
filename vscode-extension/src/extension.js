"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
var vscode = require("vscode");
var axios_1 = require("axios");
var path = require("path");
var API_URL = "http://localhost:3000/agent";
// Sama rooli kuin CLI:ssä, voit myöhemmin lisätä valinnan
var DEFAULT_ROLE = "coder";
function activate(context) {
    var _this = this;
    var output = vscode.window.createOutputChannel("Samuli Agent");
    var disposable = vscode.commands.registerCommand("samuliAgent.ask", function () { return __awaiter(_this, void 0, void 0, function () {
        var editor, workspace, projectRoot, absFile, relFile, question, message, resp, reply, usage, cost, pt, ct, tt, eur, usd, err_1, msg;
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        return __generator(this, function (_k) {
            switch (_k.label) {
                case 0:
                    editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showInformationMessage("Ei aktiivista editoria. Avaa tiedosto ensin.");
                        return [2 /*return*/];
                    }
                    workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri);
                    if (!workspace) {
                        vscode.window.showInformationMessage("Workspacea ei löytynyt. Avaa kansio projektiksi ennen agentin käyttöä.");
                        return [2 /*return*/];
                    }
                    projectRoot = workspace.uri.fsPath;
                    absFile = editor.document.uri.fsPath;
                    relFile = path
                        .relative(projectRoot, absFile)
                        .replace(/\\/g, "/");
                    return [4 /*yield*/, vscode.window.showInputBox({
                            prompt: "Kysy Samuli-agentilta (tiedosto: ".concat(relFile, ")"),
                            placeHolder: "Esim. 'selitä tämä komponentti' tai 'ehdota refaktorointia'",
                        })];
                case 1:
                    question = _k.sent();
                    if (!question) {
                        return [2 /*return*/];
                    }
                    message = "Aktiivinen tiedosto: ".concat(relFile, ".\n") +
                        "Projektin juurihakemisto: ".concat(projectRoot, ".\n\n") +
                        "K\u00E4ytt\u00E4j\u00E4n pyynt\u00F6:\n".concat(question, "\n\n") +
                        "Tutki projektia ja t\u00E4t\u00E4 tiedostoa k\u00E4ytt\u00E4en omia ty\u00F6kaluja (list_files, read_file, ts_get_outline, ts_check, search_in_files, apply_patch). " +
                        "Selit\u00E4 mit\u00E4 teet ja mit\u00E4 suosittelet. Jos ehdotat muutoksia, kerro ne selke\u00E4sti diff-tyyliin.";
                    _k.label = 2;
                case 2:
                    _k.trys.push([2, 4, , 5]);
                    output.appendLine("> ".concat(question));
                    output.show(true);
                    return [4 /*yield*/, axios_1.default.post(API_URL, {
                            message: message,
                            role: DEFAULT_ROLE,
                            projectRoot: projectRoot,
                        })];
                case 3:
                    resp = _k.sent();
                    reply = resp.data.reply;
                    usage = resp.data.usage;
                    cost = resp.data.cost;
                    output.appendLine("");
                    output.appendLine(reply.trim());
                    output.appendLine("");
                    if (usage && cost) {
                        pt = (_a = usage.promptTokens) !== null && _a !== void 0 ? _a : 0;
                        ct = (_b = usage.completionTokens) !== null && _b !== void 0 ? _b : 0;
                        tt = (_c = usage.totalTokens) !== null && _c !== void 0 ? _c : pt + ct;
                        eur = (_d = cost.eur) !== null && _d !== void 0 ? _d : 0;
                        usd = (_e = cost.usd) !== null && _e !== void 0 ? _e : 0;
                        output.appendLine("Tokens: ".concat(pt, " in, ").concat(ct, " out (total ").concat(tt, ")"));
                        output.appendLine("Arvioitu kustannus: ".concat(eur.toFixed(4), " \u20AC (").concat(usd.toFixed(4), " $)"));
                    }
                    output.appendLine("\n---\n");
                    return [3 /*break*/, 5];
                case 4:
                    err_1 = _k.sent();
                    msg = (_j = (_h = (_g = (_f = err_1 === null || err_1 === void 0 ? void 0 : err_1.response) === null || _f === void 0 ? void 0 : _f.data) === null || _g === void 0 ? void 0 : _g.message) !== null && _h !== void 0 ? _h : err_1 === null || err_1 === void 0 ? void 0 : err_1.message) !== null && _j !== void 0 ? _j : String(err_1);
                    vscode.window.showErrorMessage("Samuli-agentin kutsu epäonnistui: " + msg);
                    output.appendLine("ERROR: " + msg);
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    }); });
    context.subscriptions.push(disposable);
}
function deactivate() {
    // ei tarvita erityistä siivousta
}
