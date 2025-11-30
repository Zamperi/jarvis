// src/tools/policyTools.ts
import path from "path";

export type ActionKind =
  | "readFile"
  | "writeFile"
  | "applyPatch"
  | "runTests"
  | "runBuild"
  | "runLint";

export interface ActionDescription {
  kind: ActionKind;
  description?: string;
  targetPaths?: string[];
  estimatedChangedLines?: number;
}

export interface PolicyConfig {
  projectRoot: string;
  allowedPaths: string[];
  readOnlyPaths: string[];
  maxFilesChanged: number;
  maxTotalChangedLines: number;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  violations?: string[];
}

function isUnderDir(file: string, dir: string): boolean {
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function checkActionAgainstPolicy(
  action: ActionDescription,
  policy: PolicyConfig
): PolicyResult {
  const violations: string[] = [];
  const { projectRoot, allowedPaths, readOnlyPaths } = policy;

  const targets = action.targetPaths ?? [];

  const allowedRoots = allowedPaths.map((p) =>
    path.resolve(projectRoot, p)
  );
  const readOnlyRoots = readOnlyPaths.map((p) =>
    path.resolve(projectRoot, p)
  );

  for (const target of targets) {
    const abs = path.resolve(target);

    const inAllowed = allowedRoots.some((root) => isUnderDir(abs, root));
    if (!inAllowed) {
      violations.push(`Path not allowed by policy: ${abs}`);
      continue;
    }

    if (
      (action.kind === "writeFile" || action.kind === "applyPatch") &&
      readOnlyRoots.some((root) => isUnderDir(abs, root))
    ) {
      violations.push(`Attempt to modify read-only path: ${abs}`);
    }
  }

  if (
    action.kind === "applyPatch" &&
    typeof action.estimatedChangedLines === "number"
  ) {
    if (action.estimatedChangedLines > policy.maxTotalChangedLines) {
      violations.push(
        `Too many changed lines: ${action.estimatedChangedLines} > ${policy.maxTotalChangedLines}`
      );
    }
  }

  if (
    action.kind === "applyPatch" &&
    targets.length > policy.maxFilesChanged
  ) {
    violations.push(
      `Too many files changed in one action: ${targets.length} > ${policy.maxFilesChanged}`
    );
  }

  if (violations.length > 0) {
    return {
      allowed: false,
      reason: "Policy violation",
      violations,
    };
  }

  return { allowed: true };
}
