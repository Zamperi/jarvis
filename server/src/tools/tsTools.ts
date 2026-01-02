// src/tools/tsTools.ts
import ts from "typescript";
import path from "path";

export interface TsOutlineSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
}

export interface TsCheckDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  category: "error" | "warning" | "suggestion";
  code: number;
  message: string;
}

export interface TsProjectOptions {
  projectRoot: string;
  tsconfigPath?: string;
}

function resolveTsconfigPath(options: TsProjectOptions): string {
  if (options.tsconfigPath) {
    return path.resolve(options.projectRoot, options.tsconfigPath);
  }
  return path.resolve(options.projectRoot, "tsconfig.json");
}

async function createProgram(options: TsProjectOptions): Promise<ts.Program> {
  const tsconfigAbs = resolveTsconfigPath(options);

  const configFile = ts.readConfigFile(tsconfigAbs, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigAbs)
  );

  if (parsed.errors?.length) {
    const msg = parsed.errors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n");
    throw new Error(msg);
  }

  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
}

function isNodeExported(node: ts.Node): boolean {
  return (
    (ts.getCombinedModifierFlags(node as any) & ts.ModifierFlags.Export) !== 0 ||
    (node.parent && ts.isSourceFile(node.parent))
  );
}

function createOutlineFromSourceFile(sf: ts.SourceFile): TsOutlineSymbol[] {
  const outline: TsOutlineSymbol[] = [];

  const visit = (node: ts.Node) => {
    let name = "";
    let kind = "";

    if (ts.isFunctionDeclaration(node)) {
      kind = "function";
      if (node.name) name = node.name.text;
    } else if (ts.isClassDeclaration(node)) {
      kind = "class";
      if (node.name) name = node.name.text;
    } else if (ts.isInterfaceDeclaration(node)) {
      kind = "interface";
      name = node.name.text;
    } else if (ts.isTypeAliasDeclaration(node)) {
      kind = "type";
      name = node.name.text;
    } else if (ts.isEnumDeclaration(node)) {
      kind = "enum";
      name = node.name.text;
    } else if (ts.isVariableStatement(node)) {
      kind = "variable";
      const decl = node.declarationList.declarations[0];
      if (decl && ts.isIdentifier(decl.name)) {
        name = decl.name.text;
      }
    }

    if (name && kind) {
      const { line: startLine } = sf.getLineAndCharacterOfPosition(node.getStart());
      const { line: endLine } = sf.getLineAndCharacterOfPosition(node.getEnd());

      outline.push({
        name,
        kind,
        startLine: startLine + 1,
        endLine: endLine + 1,
        isExported: isNodeExported(node),
      });
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);

  return outline;
}

/**
 * Kääntäjän diagnostiset viestit tsconfig-projektista.
 */
export async function tsCheck(
  options: TsProjectOptions
): Promise<TsCheckDiagnostic[]> {
  const program = await createProgram(options);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  return diagnostics.map((d) => {
    let file: string | undefined;
    let line: number | undefined;
    let column: number | undefined;

    if (d.file && typeof d.start === "number") {
      file = d.file.fileName;
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      line = pos.line + 1;
      column = pos.character + 1;
    }

    const category: TsCheckDiagnostic["category"] =
      d.category === ts.DiagnosticCategory.Error
        ? "error"
        : d.category === ts.DiagnosticCategory.Warning
        ? "warning"
        : "suggestion";

    return {
      file,
      line,
      column,
      category,
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    };
  });
}

/**
 * Yhden tiedoston outline. Tämä on se, mitä agentRunner.ts käyttää.
 */
export async function getAstOutline(
  filePathAbs: string,
  options: TsProjectOptions
): Promise<TsOutlineSymbol[]> {
  const program = await createProgram(options);
  const abs = path.resolve(filePathAbs);
  const sf = program.getSourceFile(abs);
  if (!sf) {
    throw new Error(`Source file not found in TS program: ${abs}`);
  }
  return createOutlineFromSourceFile(sf);
}

/* ===========================
   Public API outline helpers
=========================== */

export interface ExportedApiSymbol {
  file: string; // absolute path
  kind: string;
  name: string;
}

/**
 * Palauttaa vain exportatut symbolit annetuista tiedostoista.
 */
export async function getExportedApiOutline(
  options: TsProjectOptions,
  filesAbs: string[]
): Promise<ExportedApiSymbol[]> {
  const program = await createProgram(options);
  const out: ExportedApiSymbol[] = [];

  for (const f of filesAbs) {
    const abs = path.resolve(f);
    const sf = program.getSourceFile(abs);
    if (!sf) continue;

    const outline = createOutlineFromSourceFile(sf);
    for (const s of outline) {
      if (!s.isExported) continue;
      out.push({ file: abs, kind: s.kind, name: s.name });
    }
  }

  out.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.kind.localeCompare(b.kind) ||
      a.name.localeCompare(b.name)
  );

  return out;
}

export function fingerprintExportedApi(symbols: ExportedApiSymbol[]): string {
  const payload = JSON.stringify(symbols);
  let h = 0;
  for (let i = 0; i < payload.length; i++) {
    h = (h * 31 + payload.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}
