// src/tools/fileTools.ts

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import fg from "fast-glob";
import { applyPatch as applyTextPatch } from "diff";

export interface FileRangeOptions {
  fromLine?: number;
  toLine?: number;
  maxBytes?: number;
}

export interface ReadFileResult {
  path: string;
  content: string;
  fromLine: number;
  toLine: number;
  totalLines: number;
  hash: string;
}

export interface ListFilesOptions {
  cwd: string;
  patterns: string[];
  ignore?: string[];
}

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  excerpt: string;
}

export interface SearchOptions {
  cwd: string;
  patterns: string[];
  query: string;
  isRegex?: boolean;
  ignore?: string[];
  maxResultsPerFile?: number;
}

export interface FindFilesByNameOptions {
  cwd: string;
  query: string;
  patterns?: string[];
  ignore?: string[];
  maxResults?: number;
}

export interface ApplyPatchInput {
  filePath: string;
  originalHash: string;
  patch: string; // unified diff
  dryRun?: boolean;
}

export interface ApplyPatchResult {
  filePath: string;
  changed: boolean;
  newHash?: string;
  preview?: string;
}

/**
 * Laskee sha256-hashin annetusta sisällöstä.
 */
function sha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Listaa tiedostot glob-patternien perusteella.
 */
export async function listFiles(
  options: ListFilesOptions
): Promise<string[]> {
  const { cwd, patterns, ignore } = options;

  const entries = await fg(patterns, {
    cwd,
    ignore,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  return entries.map((p) => path.resolve(cwd, p));
}

/**
 * Lukee tiedoston sisällön ja palauttaa mahdollisesti rajatun alueen.
 */
export async function readFileWithRange(
  filePath: string,
  options: FileRangeOptions = {}
): Promise<ReadFileResult> {
  const absPath = path.resolve(filePath);
  const raw = await fs.readFile(absPath, "utf8");

  let content = raw;
  let fromLine = options.fromLine ?? 1;
  let toLine = options.toLine ?? Number.MAX_SAFE_INTEGER;

  const lines = raw.split(/\r?\n/);
  const totalLines = lines.length;

  fromLine = Math.max(1, Math.min(fromLine, totalLines));
  toLine = Math.max(fromLine, Math.min(toLine, totalLines));

  content = lines.slice(fromLine - 1, toLine).join("\n");

  if (options.maxBytes && Buffer.byteLength(content, "utf8") > options.maxBytes) {
    let buf = Buffer.from(content, "utf8");
    buf = buf.subarray(0, options.maxBytes);
    content = buf.toString("utf8");
  }

  return {
    path: absPath,
    content,
    fromLine,
    toLine,
    totalLines,
    hash: sha256(raw),
  };
}

/**
 * Lukee koko tiedoston sisällön.
 */
export async function readFileRaw(filePath: string): Promise<string> {
  const absPath = path.resolve(filePath);
  return await fs.readFile(absPath, "utf8");
}

/**
 * Kirjoittaa annetun sisällön tiedostoon, luoden hakemiston tarvittaessa.
 */
export async function writeFileRaw(
  filePath: string,
  content: string
): Promise<string> {
  const absPath = path.resolve(filePath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, "utf8");
  return absPath;
}

// Agenttityökalu: käyttää samaa mallia kuin muut fileTools-työkalut
export const writeFileTool = {
  name: "write_file",
  description:
    "Creates or overwrites a file at the given path with the provided content.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string" },
      content: { type: "string" },
    },
    required: ["filePath", "content"],
  },

  execute: async ({ filePath, content }: { filePath: string; content: string }) => {
    try {
      const resolvedPath = path.resolve(process.cwd(), filePath);
      const dir = path.dirname(resolvedPath);

      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(resolvedPath, content, "utf-8");

      return {
        success: true,
        message: `File written: ${resolvedPath}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || String(err),
      };
    }
  },
};

/**
 * Tekstipatchin soveltaminen yhteen tiedostoon.
 *
 * Tukee sekä olemassa olevan tiedoston muokkausta että uuden tiedoston luontia:
 * - Jos tiedosto ei ole olemassa, sitä käsitellään uutena tiedostona (alkusisältö "").
 * - Hash-tarkistus tehdään vain, jos tiedosto on olemassa ja originalHash on annettu
 *   eikä se ole erikoisarvo "new-file".
 */
export async function applyPatch(
  input: ApplyPatchInput
): Promise<ApplyPatchResult> {
  const { filePath, originalHash, patch, dryRun = false } = input;

  const absPath = path.resolve(filePath);

  let current = "";
  let existedBefore = true;

  try {
    current = await fs.readFile(absPath, "utf8");
  } catch (err: any) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Tiedostoa ei ole – käsitellään uutena tiedostona
      existedBefore = false;
      current = "";
    } else {
      throw err;
    }
  }

  // Jos tiedosto oli olemassa ja meillä on alkuperäinen hash, varmistetaan ettei
  // tiedosto ole muuttunut levyllä LLM:n näkemän version jälkeen.
  if (existedBefore && originalHash && originalHash !== "new-file") {
    const currentHash = sha256(current);
    if (currentHash !== originalHash) {
      return {
        filePath: absPath,
        changed: false,
        newHash: currentHash,
        preview: "Original hash does not match, file has changed on disk.",
      };
    }
  }

  const patched = applyTextPatch(current, patch);
  if (patched === false) {
    return {
      filePath: absPath,
      changed: false,
      newHash: existedBefore ? sha256(current) : undefined,
      preview: "Failed to apply patch to file.",
    };
  }

  if (dryRun) {
    return {
      filePath: absPath,
      changed: patched !== current,
      newHash: sha256(patched),
      preview: patched,
    };
  }

  if (patched !== current) {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, patched, "utf8");
  }

  return {
    filePath: absPath,
    changed: patched !== current,
    newHash: sha256(patched),
  };
}

/**
 * Hakee tiedostoja nimen perusteella (fuzzy-ish).
 */
export async function findFilesByName(
  options: FindFilesByNameOptions
): Promise<string[]> {
  const { cwd, query, patterns, ignore, maxResults = 50 } = options;

  const globPatterns = patterns && patterns.length > 0 ? patterns : ["**/*"];

  const entries = await fg(globPatterns, {
    cwd,
    ignore,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  const lowerQuery = query.toLowerCase();

  const scored: { file: string; score: number }[] = [];

  for (const rel of entries) {
    const base = path.basename(rel).toLowerCase();

    if (base === lowerQuery) {
      scored.push({ file: rel, score: 0 });
    } else if (base.includes(lowerQuery)) {
      scored.push({ file: rel, score: 1 });
    }
  }

  scored.sort((a, b) => a.score - b.score);

  return scored.slice(0, maxResults).map((s) => path.resolve(cwd, s.file));
}

/**
 * Tekstipohjainen haku tiedostoista.
 */
export async function searchInFiles(
  options: SearchOptions
): Promise<SearchMatch[]> {
  const {
    cwd,
    patterns,
    query,
    isRegex = false,
    ignore,
    maxResultsPerFile = 5,
  } = options;

  const entries = await fg(patterns, {
    cwd,
    ignore,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  const matches: SearchMatch[] = [];

  const regex = isRegex ? new RegExp(query, "i") : null;

  for (const relPath of entries) {
    const absPath = path.resolve(cwd, relPath);
    let content: string;
    try {
      content = await fs.readFile(absPath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);

    let foundInFile = 0;

    for (let i = 0; i < lines.length; i++) {
      if (foundInFile >= maxResultsPerFile) break;

      const line = lines[i];
      let idx = -1;

      if (regex) {
        const m = regex.exec(line);
        if (!m || m.index === undefined) continue;
        idx = m.index;
      } else {
        idx = line.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) continue;
      }

      const start = Math.max(0, idx - 20);
      const end = Math.min(line.length, idx + query.length + 20);
      const excerpt = line.slice(start, end);

      matches.push({
        file: relPath,
        line: i + 1,
        column: idx + 1,
        excerpt,
      });

      foundInFile++;
    }
  }

  return matches;
}
