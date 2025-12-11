// src/tools/projectTools.ts
import fs from "fs/promises";
import path from "path";

export interface ProjectInfo {
  packageJson?: {
    name?: string;
    version?: string;
    private?: boolean;
    scripts?: Record<string, string>;
    dependenciesCount?: number;
    devDependenciesCount?: number;
  };
  tsconfig?: {
    compilerOptions?: {
      target?: string;
      module?: string;
      strict?: boolean;
      jsx?: string;
      moduleResolution?: string;
      baseUrl?: string;
      paths?: Record<string, string[]>;
    };
    include?: unknown;
    exclude?: unknown;
  };
  entryCandidates: string[];
}

export async function getProjectInfo(opts: {
  projectRoot: string;
}): Promise<ProjectInfo> {
  const { projectRoot } = opts;
  const result: ProjectInfo = { entryCandidates: [] };

  // package.json tiivistelmä
  const packageJsonPath = path.join(projectRoot, "package.json");
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw);

    const deps =
      pkg.dependencies && typeof pkg.dependencies === "object"
        ? Object.keys(pkg.dependencies).length
        : 0;
    const devDeps =
      pkg.devDependencies && typeof pkg.devDependencies === "object"
        ? Object.keys(pkg.devDependencies).length
        : 0;

    result.packageJson = {
      name: pkg.name,
      version: pkg.version,
      private: pkg.private,
      scripts: pkg.scripts,
      dependenciesCount: deps,
      devDependenciesCount: devDeps,
    };
  } catch {
    // ei pakko olla package.json
  }

  // tsconfig.json tiivistelmä
  const tsconfigPath = path.join(projectRoot, "tsconfig.json");
  try {
    const raw = await fs.readFile(tsconfigPath, "utf8");
    const ts = JSON.parse(raw);
    const co = ts.compilerOptions || {};

    result.tsconfig = {
      compilerOptions: {
        target: co.target,
        module: co.module,
        strict: co.strict,
        jsx: co.jsx,
        moduleResolution: co.moduleResolution,
        baseUrl: co.baseUrl,
        paths: co.paths,
      },
      include: ts.include,
      exclude: ts.exclude,
    };
  } catch {
    // ei pakko olla tsconfigia
  }

  // entrypoint-kandidaatit
  const candidates = [
    "src/index.ts",
    "src/index.tsx",
    "src/main.ts",
    "src/main.tsx",
    "src/server.ts",
    "src/app.tsx",
  ];
  const existing: string[] = [];

  for (const rel of candidates) {
    try {
      await fs.access(path.join(projectRoot, rel));
      existing.push(rel);
    } catch {
      // ei ole, skip
    }
  }

  result.entryCandidates = existing;

  return result;
}

// -------- JSON compact --------

function truncateValue(value: any, maxLen: number): any {
  if (typeof value === "string") {
    if (value.length <= maxLen) return value;
    return (
      value.slice(0, maxLen) +
      `... (truncated, original length ${value.length})`
    );
  }

  if (Array.isArray(value)) {
    return value.map((v) => truncateValue(v, maxLen));
  }

  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = truncateValue(v, maxLen);
    }
    return out;
  }

  return value;
}

export async function readJsonCompact(opts: {
  filePath: string;
  pickKeys?: string[];
  maxStringLength?: number;
}): Promise<any> {
  const { filePath, pickKeys, maxStringLength = 200 } = opts;

  const raw = await fs.readFile(filePath, "utf8");
  const json = JSON.parse(raw);

  let subset: any = json;

  if (
    Array.isArray(pickKeys) &&
    pickKeys.length > 0 &&
    json &&
    typeof json === "object"
  ) {
    subset = {};
    for (const key of pickKeys) {
      if (Object.prototype.hasOwnProperty.call(json, key)) {
        subset[key] = (json as any)[key];
      }
    }
  }

  return truncateValue(subset, maxStringLength);
}

// -------- Run log / virheloki --------

export interface RunLogOptions {
  projectRoot: string;
  relativePath: string;
  maxChars?: number;
}

export interface RunLogResult {
  logPath: string;
  content: string;
  totalChars: number;
}

export async function getRunLog(
  opts: RunLogOptions
): Promise<RunLogResult> {
  const { projectRoot, relativePath, maxChars = 4000 } = opts;
  const fullPath = path.join(projectRoot, relativePath);

  const raw = await fs.readFile(fullPath, "utf8");
  const totalChars = raw.length;

  let content = raw;
  if (raw.length > maxChars) {
    content = raw.slice(raw.length - maxChars);
  }

  return {
    logPath: relativePath,
    content,
    totalChars,
  };
}
