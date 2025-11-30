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
export function sha256(content: string | Buffer): string {
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
 * Lukee tiedoston, tukee rivialuetta ja maxBytes-rajausta.
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
 * Kirjoittaa sisällön tiedostoon (overwrites).
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

/**
 * Tekstihaku tiedostoista.
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
    maxResultsPerFile = 20,
  } = options;

  const files = await listFiles({ cwd, patterns, ignore });
  const matches: SearchMatch[] = [];

  const regex = isRegex ? new RegExp(query, "g") : null;

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const lines = content.split(/\r?\n/);
    let countForFile = 0;

    for (let i = 0; i < lines.length; i++) {
      if (countForFile >= maxResultsPerFile) break;

      const line = lines[i];
      let idx = -1;

      if (regex) {
        const m = line.match(regex);
        if (!m) continue;
        idx = line.search(regex);
      } else {
        idx = line.indexOf(query);
        if (idx === -1) continue;
      }

      const start = Math.max(0, idx - 40);
      const end = Math.min(line.length, idx + query.length + 40);
      const excerpt = line.slice(start, end);

      matches.push({
        file,
        line: i + 1,
        column: idx + 1,
        excerpt,
      });

      countForFile++;
    }
  }

  return matches;
}

/**
 * Soveltaa unified diff -patchin yhteen tiedostoon.
 */
export async function applyPatch(
  input: ApplyPatchInput
): Promise<ApplyPatchResult> {
  const { filePath, originalHash, patch, dryRun } = input;
  const absPath = path.resolve(filePath);

  let current = "";
  try {
    current = await fs.readFile(absPath, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`File not found: ${absPath}`);
    }
    throw err;
  }

  const currentHash = sha256(current);
  if (currentHash !== originalHash) {
    throw new Error(
      `Hash mismatch for ${absPath}. File has changed since it was read.`
    );
  }

  const patched = applyTextPatch(current, patch);
  if (patched === false) {
    throw new Error(`Failed to apply patch to ${absPath}`);
  }

  if (dryRun) {
    return {
      filePath: absPath,
      changed: patched !== current,
      preview: patched,
      newHash: sha256(patched),
    };
  }

  if (patched !== current) {
    await fs.writeFile(absPath, patched, "utf8");
  }

  return {
    filePath: absPath,
    changed: patched !== current,
    newHash: sha256(patched),
  };
}
