// src/tools/execTools.ts
import { spawn } from "child_process";

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number
): Promise<CommandResult> {
  const effectiveTimeoutMs = timeoutMs ?? 10 * 60 * 1000;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill("SIGKILL");
        reject(
          new Error(
            `Command timed out after ${effectiveTimeoutMs} ms: ${command} ${args.join(
              " "
            )}`
          )
        );
      }
    }, effectiveTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
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
