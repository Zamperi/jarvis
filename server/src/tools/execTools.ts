// src/tools/execTools.ts
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    const timer =
      typeof timeoutMs === "number" && timeoutMs > 0
        ? setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {}
          }, timeoutMs)
        : null;

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        command,
        args,
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
}

export async function runTests(cwd: string): Promise<CommandResult> {
  return runCommand("npm", ["test"], cwd);
}

export async function runBuild(cwd: string): Promise<CommandResult> {
  return runCommand("npm", ["run", "build"], cwd);
}

export async function runLint(cwd: string): Promise<CommandResult> {
  return runCommand("npm", ["run", "lint"], cwd);
}

/* ===========================
   Git helpers (for transactional task execution)
=========================== */

export async function gitIsRepo(cwd: string): Promise<boolean> {
  const res = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], cwd);
  return res.exitCode === 0 && res.stdout.trim() === "true";
}

export interface GitStatusEntry {
  path: string; // repo-relative path with forward slashes
  indexStatus: string;
  worktreeStatus: string;
  isUntracked: boolean;
}

export async function gitStatusPorcelain(cwd: string): Promise<GitStatusEntry[]> {
  const res = await runCommand("git", ["status", "--porcelain=v1"], cwd);
  if (res.exitCode !== 0) return [];
  const lines = res.stdout.split(/\r?\n/).filter(Boolean);
  const entries: GitStatusEntry[] = [];
  for (const line of lines) {
    // format: XY <path>  OR  ?? <path>
    const x = line.slice(0, 1);
    const y = line.slice(1, 2);
    const rest = line.slice(3).trim();
    const isUntracked = x === "?" && y === "?";
    const p = rest.replace(/\\/g, "/");
    entries.push({
      path: p,
      indexStatus: x,
      worktreeStatus: y,
      isUntracked,
    });
  }
  return entries;
}

export async function gitCheckoutFiles(cwd: string, files: string[]): Promise<CommandResult> {
  if (files.length === 0) {
    return { command: "git", args: ["checkout", "--"], exitCode: 0, stdout: "", stderr: "" };
  }
  return runCommand("git", ["checkout", "--", ...files], cwd);
}

export async function gitDeleteUntracked(cwd: string, files: string[]): Promise<void> {
  // Delete specific untracked files (safer than git clean -fd)
  for (const f of files) {
    const abs = path.resolve(cwd, f);
    try {
      await fs.rm(abs, { force: true, recursive: true });
    } catch {}
  }
}
