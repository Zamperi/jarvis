// src/tools/fileTools.ts
import fs from "fs/promises";
import path from "path";
import { fileAccessConfig, roleFilePolicies, AgentRole } from "../config/projectConfig";

const AUDIT_LOG_PATH = path.resolve(fileAccessConfig.rootDir, "agent-audit.log");

function normalizeRelativePath(relativePath: string): string {
  // poistetaan johtava "/" jos sellainen tulee LLM:ltä
  return relativePath.replace(/^[/\\]+/, "");
}

function resolveProjectPath(relativePath: string): string {
  const root = fileAccessConfig.rootDir;
  const normalized = normalizeRelativePath(relativePath);
  const fullPath = path.resolve(root, normalized);

  const normalizedRoot = root.endsWith(path.sep) ? root : root + path.sep;
  if (!fullPath.startsWith(normalizedRoot)) {
    throw new Error(
      `Path outside project root blocked: ${relativePath} -> ${fullPath}`
    );
  }

  return fullPath;
}

function checkFilePolicy(role: AgentRole, op: "read" | "write", relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  const policy = roleFilePolicies[role];

  // Jos roolille ei ole määritelty polkuja → ei pääsyä mihinkään
  if (!policy) {
    throw new Error(`No file policy defined for role: ${role}`);
  }

  // allowedPaths: ainakin yhden pitää täsmätä prefixiksi
  const isAllowed = policy.allowedPaths.length === 0
    ? false
    : policy.allowedPaths.some((prefix) =>
      normalized === prefix || normalized.startsWith(prefix)
    );

  if (!isAllowed) {
    throw new Error(
      `Policy violation: role "${role}" not allowed to ${op} "${normalized}"`
    );
  }

  // readOnlyPaths: jos osuu ja op = write → estetään
  if (
    op === "write" &&
    policy.readOnlyPaths.some(
      (prefix) => normalized === prefix || normalized.startsWith(prefix)
    )
  ) {
    throw new Error(
      `Policy violation: role "${role}" cannot write to read-only path "${normalized}"`
    );
  }
}

async function appendAuditLog(entry: {
  role: AgentRole;
  op: "read" | "write";
  relativePath: string;
  absolutePath?: string;
  ok: boolean;
  error?: string;
}) {
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    }) + "\n";

  try {
    await fs.appendFile(AUDIT_LOG_PATH, line, {
      encoding: "utf8",
      flag: "a",
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

export async function readFileSafe(
  role: AgentRole,
  relativePath: string
): Promise<string> {
  let abs: string | undefined;
  const normalized = normalizeRelativePath(relativePath);

  try {
    checkFilePolicy(role, "read", normalized);
    abs = resolveProjectPath(normalized);

    const content = await fs.readFile(abs, "utf8");

    await appendAuditLog({
      role,
      op: "read",
      relativePath: normalized,
      absolutePath: abs,
      ok: true,
    });

    return content;
  } catch (err: any) {
    await appendAuditLog({
      role,
      op: "read",
      relativePath: normalized,
      absolutePath: abs,
      ok: false,
      error: err?.message ?? String(err),
    });
    throw err;
  }
}

export async function writeFileSafe(
  role: AgentRole,
  relativePath: string,
  content: string
): Promise<void> {
  let abs: string | undefined;
  const normalized = normalizeRelativePath(relativePath);

  try {
    checkFilePolicy(role, "write", normalized);
    abs = resolveProjectPath(normalized);

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");

    await appendAuditLog({
      role,
      op: "write",
      relativePath: normalized,
      absolutePath: abs,
      ok: true,
    });
  } catch (err: any) {
    await appendAuditLog({
      role,
      op: "write",
      relativePath: normalized,
      absolutePath: abs,
      ok: false,
      error: err?.message ?? String(err),
    });
    throw err;
  }
}
