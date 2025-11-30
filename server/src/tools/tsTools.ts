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

async function loadTsConfig(
  projectRoot: string,
  tsconfigPath?: string
): Promise<ts.ParsedCommandLine> {
  const configFileName =
    tsconfigPath ?? path.join(projectRoot, "tsconfig.json");

  const configFile = ts.readConfigFile(configFileName, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Failed to read tsconfig: ${configFile.error.messageText}`
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configFileName)
  );

  return parsed;
}

async function createProgram(
  options: TsProjectOptions
): Promise<ts.Program> {
  const { projectRoot, tsconfigPath } = options;
  const parsed = await loadTsConfig(projectRoot, tsconfigPath);

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });

  return program;
}

export async function getAstOutline(
  filePath: string,
  options: TsProjectOptions
): Promise<TsOutlineSymbol[]> {
  const program = await createProgram(options);
  const absPath = path.resolve(filePath);
  const sf = program.getSourceFile(absPath);
  if (!sf) {
    throw new Error(`Source file not in program: ${absPath}`);
  }

  const outline: TsOutlineSymbol[] = [];

  const visit = (node: ts.Node) => {
    let kind: string | null = null;
    let name: string | undefined;

    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node)
    ) {
      kind = "function";
      const n = (node as any).name;
      if (n && ts.isIdentifier(n)) name = n.text;
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
      if (ts.isIdentifier(decl.name)) {
        name = decl.name.text;
      }
    }

    if (kind && name) {
      const { line: startLine } = sf.getLineAndCharacterOfPosition(
        node.getStart(sf, false)
      );
      const { line: endLine } = sf.getLineAndCharacterOfPosition(
        node.getEnd()
      );

      let isExported = false;
      if (ts.canHaveModifiers(node)) {
        const modifiers = ts.getModifiers(node) ?? [];
        isExported = modifiers.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword
        );
      }

      outline.push({
        name,
        kind,
        startLine: startLine + 1,
        endLine: endLine + 1,
        isExported,
      });
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);

  return outline;
}

export async function tsCheck(
  options: TsProjectOptions
): Promise<TsCheckDiagnostic[]> {
  const program = await createProgram(options);
  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getOptionsDiagnostics(),
  ];

  const result: TsCheckDiagnostic[] = diagnostics.map((d) => {
    const category: TsCheckDiagnostic["category"] =
      d.category === ts.DiagnosticCategory.Error
        ? "error"
        : d.category === ts.DiagnosticCategory.Warning
        ? "warning"
        : "suggestion";

    let file: string | undefined;
    let line: number | undefined;
    let column: number | undefined;

    if (d.file && typeof d.start === "number") {
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      file = d.file.fileName;
      line = pos.line + 1;
      column = pos.character + 1;
    }

    return {
      file,
      line,
      column,
      category,
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    };
  });

  return result;
}
